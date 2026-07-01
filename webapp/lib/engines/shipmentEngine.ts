import type { Shipment } from '@/lib/types/shipment'
import type { QuestionNode } from '@/lib/config/decisionTree'

/**
 * Применяет ответ пользователя к текущей модели Shipment и логирует его.
 * Больше ничего не пересчитывает — это задача остальных движков.
 */
export function applyAnswer(shipment: Shipment, node: QuestionNode, rawAnswer: string): Shipment {
  const patch = node.applyAnswer(shipment, rawAnswer)

  return {
    ...shipment,
    ...patch,
    answers_log: [
      ...shipment.answers_log,
      { question_id: node.id, answer: rawAnswer, answered_at: new Date().toISOString() },
    ],
  }
}
