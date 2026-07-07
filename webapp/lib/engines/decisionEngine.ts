import type { Shipment } from '@/lib/types/shipment'
import { DECISION_TREE, START_QUESTION_ID, type QuestionNode } from '@/lib/config/decisionTree'

export interface SerializedQuestion {
  id: string
  prompt: string
  type: QuestionNode['type']
  options?: QuestionNode['options']
  optional?: boolean
  autocomplete?: boolean
  withAttachment?: boolean
  preselected?: string[]
}

export function getQuestionNode(questionId: string): QuestionNode {
  const node = DECISION_TREE[questionId]
  if (!node) throw new Error(`Неизвестный вопрос: ${questionId}`)
  return node
}

export function getStartQuestion(): SerializedQuestion {
  return serializeQuestion(getQuestionNode(START_QUESTION_ID))
}

export function getNextQuestion(node: QuestionNode, shipment: Shipment, rawAnswer: string): SerializedQuestion | null {
  const nextId = node.next(shipment, rawAnswer)
  if (!nextId) return null
  return serializeQuestion(getQuestionNode(nextId), shipment)
}

export interface AskedQuestion {
  question: SerializedQuestion
  step: number
}

export interface QuizState {
  question: SerializedQuestion | null
  step: number
  history: AskedQuestion[]
}

/**
 * Восстанавливает всю цепочку вопросов незавершённой сессии по answers_log —
 * нужно и для резюме сессии, и для кнопки "назад" после переоткрытия приложения.
 */
export function resolveQuizState(shipment: Shipment): QuizState {
  const asked: AskedQuestion[] = [{ question: getStartQuestion(), step: 0 }]

  for (const entry of shipment.answers_log) {
    const node = getQuestionNode(entry.question_id)
    const next = getNextQuestion(node, shipment, String(entry.answer))
    if (!next) break
    asked.push({ question: next, step: asked.length })
  }

  if (asked.length === shipment.answers_log.length) {
    return { question: null, step: asked.length, history: asked }
  }

  const current = asked[asked.length - 1]
  return { question: current.question, step: current.step, history: asked.slice(0, -1) }
}

export function serializeQuestion(node: QuestionNode, shipment?: Shipment): SerializedQuestion {
  return {
    id: node.id,
    prompt: node.prompt,
    type: node.type,
    options: node.options,
    optional: node.optional,
    autocomplete: node.autocomplete,
    withAttachment: node.withAttachment,
    preselected: shipment && node.preselect ? node.preselect(shipment) : undefined,
  }
}
