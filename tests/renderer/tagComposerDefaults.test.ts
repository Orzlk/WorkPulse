import { describe, expect, it } from 'vitest'
import { applySelectedTagToComposer } from '../../src/renderer/src/lib/tagComposerDefaults'

describe('tag composer defaults', () => {
  it('prepends a selected hierarchical tag to an empty composer', () => {
    expect(applySelectedTagToComposer('', '工作/三峡')).toEqual({
      text: '#工作/三峡 ',
      autoPrefix: '#工作/三峡 '
    })
  })

  it('replaces only the previous automatic prefix and preserves the draft', () => {
    expect(applySelectedTagToComposer('#工作/旧 内容', '工作/新', '#工作/旧 ')).toEqual({
      text: '#工作/新 内容',
      autoPrefix: '#工作/新 '
    })
  })

  it('removes only the automatic prefix when the tag filter is cleared', () => {
    expect(applySelectedTagToComposer('#工作/三峡 继续记录', '', '#工作/三峡 ')).toEqual({
      text: '继续记录',
      autoPrefix: ''
    })
  })

  it('does not duplicate a tag already present in the draft', () => {
    expect(applySelectedTagToComposer('完成 #工作/三峡', '工作/三峡')).toEqual({
      text: '完成 #工作/三峡',
      autoPrefix: ''
    })
  })
})
