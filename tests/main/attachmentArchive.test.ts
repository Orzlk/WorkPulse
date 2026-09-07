import { describe, expect, it } from 'vitest'

import {
  collectAttachmentNames,
  createAttachmentArchive,
  readAttachmentArchive,
  removeUnreferencedAttachments
} from '../../src/main/attachments/attachmentArchive'
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach } from 'vitest'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('attachment archive', () => {
  it('round trips data and attachment entries through a zip archive', () => {
    const archive = createAttachmentArchive([
      { name: 'data.json', data: Buffer.from('{"format":"workpulse-data"}', 'utf8') },
      { name: 'attachments/image.png', data: Buffer.from([0, 1, 2, 3]) }
    ])

    const entries = readAttachmentArchive(archive)

    expect(entries.map((entry) => entry.name)).toEqual(['data.json', 'attachments/image.png'])
    expect(entries[0].data.toString('utf8')).toContain('workpulse-data')
    expect([...entries[1].data]).toEqual([0, 1, 2, 3])
  })

  it('rejects unsafe archive paths', () => {
    expect(() => createAttachmentArchive([{ name: '../outside.txt', data: Buffer.from('x') }])).toThrow('Archive entry path is invalid')
  })

  it('writes consistent EOCD entry counts for standard archive readers', () => {
    const archive = createAttachmentArchive([
      { name: 'data.json', data: Buffer.from('{}') },
      { name: 'attachments/image.png', data: Buffer.from('image') }
    ])

    const endOffset = archive.length - 22
    expect(archive.readUInt16LE(endOffset + 8)).toBe(2)
    expect(archive.readUInt16LE(endOffset + 10)).toBe(2)
  })

  const windowsOnly = process.platform === 'win32' ? it : it.skip
  windowsOnly('opens the archive with .NET System.IO.Compression', () => {
    const root = mkdtempSync(join(tmpdir(), 'workpulse-dotnet-zip-'))
    directories.push(root)
    const archivePath = join(root, 'backup.zip')
    writeFileSync(archivePath, createAttachmentArchive([
      { name: 'data.json', data: Buffer.from('{"ok":true}', 'utf8') },
      { name: 'attachments/image.txt', data: Buffer.from('image-data', 'utf8') }
    ]))

    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [IO.Compression.ZipFile]::OpenRead($env:WORKPULSE_ARCHIVE_PATH); try { @($zip.Entries | ForEach-Object { $reader = [IO.StreamReader]::new($_.Open()); try { [PSCustomObject]@{ Name = $_.FullName; Content = $reader.ReadToEnd() } } finally { $reader.Dispose() } }) | ConvertTo-Json -Compress } finally { $zip.Dispose() }"
    ], {
      encoding: 'utf8',
      env: { ...process.env, WORKPULSE_ARCHIVE_PATH: archivePath }
    })

    const entries = JSON.parse(output) as Array<{ Name: string; Content: string }>
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.Name)).toEqual(['data.json', 'attachments/image.txt'])
    expect(entries.map((entry) => entry.Content)).toEqual(['{"ok":true}', 'image-data'])
  })

  it('keeps references written as markdown links and reference links', () => {
    expect(collectAttachmentNames({
      inline: '![a](workpulse-attachment://attachment/a.png?size=1)',
      reference: '[a]: workpulse-attachment://attachment/b.png'
    })).toEqual(['a.png', 'b.png'])
  })

  it('rejects an entry when the declared uncompressed size is inconsistent', () => {
    const archive = createAttachmentArchive([{ name: 'data.json', data: Buffer.from('{}') }])
    const centralOffset = archive.readUInt32LE(archive.length - 6)
    const corrupted = Buffer.from(archive)
    corrupted.writeUInt32LE(1, centralOffset + 24)

    expect(() => readAttachmentArchive(corrupted)).toThrow()
  })

  it('removes only unreferenced attachments older than the grace period', () => {
    const root = mkdtempSync(join(tmpdir(), 'workpulse-archive-cleanup-'))
    directories.push(root)
    const now = Date.now()
    const referenced = join(root, 'referenced.png')
    const expired = join(root, 'expired.png')
    const recent = join(root, 'recent.png')
    const nestedDirectory = join(root, 'nested')
    writeFileSync(referenced, 'referenced')
    writeFileSync(expired, 'expired')
    writeFileSync(recent, 'recent')
    mkdirSync(nestedDirectory)
    symlinkSync(join(root, 'gone.png'), join(root, 'missing-link.png'))
    utimesSync(expired, new Date(now - 24 * 60 * 60 * 1000 - 1), new Date(now - 24 * 60 * 60 * 1000 - 1))

    expect(removeUnreferencedAttachments(root, ['referenced.png'], 24 * 60 * 60 * 1000, now)).toEqual(['expired.png'])
    expect(existsSync(referenced)).toBe(true)
    expect(existsSync(recent)).toBe(true)
    expect(existsSync(nestedDirectory)).toBe(true)
    expect(() => removeUnreferencedAttachments(join(root, 'missing'), [], 0, now)).not.toThrow()
  })
})
