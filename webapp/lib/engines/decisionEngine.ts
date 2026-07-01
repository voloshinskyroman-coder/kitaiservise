import type { Shipment } from '@/lib/types/shipment'
import { DECISION_TREE, START_QUESTION_ID, type QuestionNode } from '@/lib/config/decisionTree'

export interface SerializedQuestion {
  id: string
  prompt: string
  type: QuestionNode['type']
  options?: QuestionNode['options']
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
  return serializeQuestion(getQuestionNode(nextId))
}

export function serializeQuestion(node: QuestionNode): SerializedQuestion {
  return { id: node.id, prompt: node.prompt, type: node.type, options: node.options }
}
