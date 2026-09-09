import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { stockLabelSource } from './lib/labelSource'

/**
 * What stock offers other modules without being imported by them.
 *
 * `orva_documents` prints the lot label and resolves this softly: with stock
 * unregistered the label type reports itself unavailable instead of failing
 * the preview screen. Same shape of seam as purchasing's document source.
 */
export const ORVA_STOCK_LABEL_SOURCE = 'orvaStockLabelSource' as const

export function register(container: AppContainer) {
  container.register({
    [ORVA_STOCK_LABEL_SOURCE]: asValue(stockLabelSource),
  })
}
