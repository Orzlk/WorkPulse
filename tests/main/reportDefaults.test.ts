import { describe, expect, it } from 'vitest'

import {
  DEFAULT_REPORT_TEMPLATE,
  DEFAULT_REPORT_TEMPLATE_EN,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT_EN
} from '../../src/main/ai'
import { generatePeriodReportContent } from '../../src/main/reports/periodReportAi'
import { resolveReportPeriod } from '../../src/main/lib/period'

describe('report generation defaults', () => {
  it('provides a professional, evidence-based Chinese default prompt and template', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('工作总结与项目汇报助手')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('核心功能、产品或模块改动')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Git 记录处理')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('不得虚构数据、项目、成果、完成状态或业务价值')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('最后只输出完整的 Markdown 工作汇报')
    expect(DEFAULT_REPORT_TEMPLATE).toContain('# 工作汇报｜{{dateFrom}} 至 {{dateTo}}')
    expect(DEFAULT_REPORT_TEMPLATE).toContain('## 一、总体进展')
    expect(DEFAULT_REPORT_TEMPLATE).toContain('## 二、项目进展')
    expect(DEFAULT_REPORT_TEMPLATE).toContain('## 三、关键成果')
    expect(DEFAULT_REPORT_TEMPLATE).toContain('## 四、进行中与下一步')
    expect(DEFAULT_REPORT_TEMPLATE).not.toContain('下周计划')
  })

  it('provides the equivalent English defaults', () => {
    expect(DEFAULT_SYSTEM_PROMPT_EN).toContain('work summary and project reporting assistant')
    expect(DEFAULT_SYSTEM_PROMPT_EN).toContain('Git records')
    expect(DEFAULT_SYSTEM_PROMPT_EN).toContain('Do not invent')
    expect(DEFAULT_REPORT_TEMPLATE_EN).toContain('# Work Report | {{dateFrom}} to {{dateTo}}')
    expect(DEFAULT_REPORT_TEMPLATE_EN).toContain('## 1. Overall Progress')
    expect(DEFAULT_REPORT_TEMPLATE_EN).toContain('## 2. Project Progress')
    expect(DEFAULT_REPORT_TEMPLATE_EN).toContain('## 3. Key Outcomes')
    expect(DEFAULT_REPORT_TEMPLATE_EN).toContain('## 4. In Progress and Next Steps')
  })

  it('uses the same evidence-based principles for weekly and monthly snapshot reports', async () => {
    let systemPrompt = ''
    let userPrompt = ''
    const period = resolveReportPeriod('weekly', '2026-08-23', 'Asia/Shanghai')
    await generatePeriodReportContent(
      { schema_version: 1, projects: [{ name: 'Alpha' }] },
      'weekly',
      period,
      {
        provider: async (input) => {
          systemPrompt = input.systemPrompt
          userPrompt = input.userPrompt
          return '# 工作汇报\n\n完成。'
        }
      }
    )

    expect(systemPrompt).toContain('工作总结与项目汇报助手')
    expect(systemPrompt).toContain('核心功能、产品或模块改动')
    expect(systemPrompt).toContain('不得虚构数据、项目、成果、完成状态或业务价值')
    expect(systemPrompt).toContain(period.label)
    expect(userPrompt).toContain('# 工作汇报｜2026-08-17 至 2026-08-23')
  })
})
