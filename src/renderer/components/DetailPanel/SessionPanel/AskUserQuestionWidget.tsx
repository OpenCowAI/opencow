// SPDX-License-Identifier: Apache-2.0

/**
 * AskUserQuestionWidget — Widget Tool adapter for AskUserQuestion.
 *
 * Bridges the WidgetToolProps interface to AskUserQuestionCard.
 * Extracts `questions` from the block's input and delegates rendering entirely
 * to AskUserQuestionCard. Falls back to an empty fragment when no valid
 * questions are found (e.g. during early streaming before input is populated).
 */

import { AskUserQuestionCard } from './AskUserQuestionWidgets'
import type { Question } from './AskUserQuestionWidgets'
import type { WidgetToolProps } from './WidgetToolRegistry'

export function AskUserQuestionWidget({ block }: WidgetToolProps): React.JSX.Element {
  const questions: Question[] | null =
    Array.isArray(block.input.questions) && block.input.questions.length > 0
      ? (block.input.questions as Question[])
      : null

  if (!questions) return <></>

  return <AskUserQuestionCard questions={questions} toolUseId={block.id} />
}
