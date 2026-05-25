import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenUsageCard } from '../token-usage-card'

const useUsageComparisonMock = vi.hoisted(() => vi.fn())

vi.mock('../use-token-usage', () => ({
  useUsageComparison: useUsageComparisonMock,
}))

describe('TokenUsageCard', () => {
  beforeEach(() => {
    useUsageComparisonMock.mockReset()
    useUsageComparisonMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    })
  })

  it('renders usage metrics and a baseline compare affordance', () => {
    const html = renderToStaticMarkup(
      <TokenUsageCard
        workflowId="candidate-1"
        summary={{
          workflow_id: 'candidate-1',
          input_tokens: 100,
          output_tokens: 50,
          cache_read_tokens: 10,
          cache_write_tokens: 5,
          reasoning_tokens: 3,
          total_tokens: 168,
          cost_usd: 0.0123,
          row_count: 1,
          by_agent: [],
        }}
      />,
    )

    expect(html).toContain('Token Usage')
    expect(html).toContain('168')
    expect(html).toContain('Compare against baseline')
    expect(html).toContain('No comparison loaded')
    expect(useUsageComparisonMock).toHaveBeenCalledWith('candidate-1', '')
  })

  it('renders empty usage state before compare controls', () => {
    const html = renderToStaticMarkup(
      <TokenUsageCard
        workflowId="candidate-1"
        summary={{
          workflow_id: 'candidate-1',
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          reasoning_tokens: 0,
          total_tokens: 0,
          cost_usd: null,
          row_count: 0,
          by_agent: [],
        }}
      />,
    )

    expect(html).toContain('No token usage has been recorded')
  })
})
