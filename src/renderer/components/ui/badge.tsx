// SPDX-License-Identifier: Apache-2.0

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow',
        secondary:
          'border-transparent bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]',
        destructive:
          'border-transparent bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] shadow',
        outline: 'text-[hsl(var(--foreground))]',
        active: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        waiting: 'border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        error: 'border-transparent bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        completed: 'border-transparent bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
