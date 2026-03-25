// SPDX-License-Identifier: Apache-2.0

/**
 * TodoWriteWidget — Widget Tool adapter for TodoWrite.
 *
 * Bridges the WidgetToolProps interface to TodoCard.
 * Extracts `todos` from the block's input and delegates rendering entirely
 * to TodoCard. Falls back to an empty fragment when no valid todos are found.
 */

import { TodoCard } from './TodoWidgets'
import type { TodoItem } from './TodoWidgets'
import type { WidgetToolProps } from './WidgetToolRegistry'

export function TodoWriteWidget({ block }: WidgetToolProps): React.JSX.Element {
  const todos: TodoItem[] | null =
    Array.isArray(block.input.todos) && block.input.todos.length > 0
      ? (block.input.todos as TodoItem[])
      : null

  if (!todos) return <></>

  return <TodoCard todos={todos} />
}
