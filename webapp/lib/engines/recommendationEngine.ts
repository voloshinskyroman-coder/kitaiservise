import type { CalculationAccuracy } from '@/lib/types/shipment'

export const ACCURACY_LABEL: Record<CalculationAccuracy, string> = {
  high: 'точный расчёт',
  medium: 'приблизительный расчёт',
  low: 'ориентировочный расчёт',
}

/**
 * Если данных достаточно — ничего не поясняем, показываем расчёт как есть.
 * Если нет — объясняем пользователю, каких данных не хватает для точности.
 */
export function getAccuracyHint(accuracy: CalculationAccuracy, missingFieldLabels: string[]): string | null {
  if (accuracy === 'high' || missingFieldLabels.length === 0) return null
  return `Это ${accuracy === 'low' ? 'широкий' : 'приблизительный'} диапазон. Точнее посчитаем, если укажете: ${missingFieldLabels.join(', ')}.`
}
