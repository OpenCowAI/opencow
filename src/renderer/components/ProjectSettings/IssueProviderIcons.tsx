// SPDX-License-Identifier: Apache-2.0

/**
 * Brand SVG icons for issue provider platforms (GitHub, GitLab, Linear).
 *
 * Each component accepts standard SVG props and uses `currentColor` by default
 * so the icon inherits the parent's text color — override with `className` or `fill`.
 */

import type { SVGAttributes } from 'react'
import { cn } from '@/lib/utils'
import type { IssueProviderPlatform } from '@shared/types'

type IconProps = SVGAttributes<SVGSVGElement>

/** GitHub Invertocat mark. Source: SVG Repo. */
export function GitHubIcon({ className, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      className={cn('w-4 h-4', className)}
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M10 0C4.478 0 0 4.59 0 10.253c0 4.529 2.862 8.371 6.833 9.728.5.101.68-.22.68-.493 0-.216-.012-1.32-.012-2.692 0 0-2.759.592-3.339-1.18 0 0-.45-1.154-1.098-1.451 0 0-.897-.616.066-.604 0 0 .975.078 1.512 1.014.882 1.516 2.326 1.08 2.895.818.089-.636.344-1.08.627-1.353-2.202-.255-4.466-1.122-4.466-5.06 0-1.12.388-2.034 1.03-2.752-.104-.259-.447-1.302.098-2.714 0 0 .838-.275 2.747 1.051A9.537 9.537 0 0 1 10 4.958c.85.004 1.705.118 2.503.345 1.911-1.326 2.747-1.051 2.747-1.051.545 1.412.202 2.455.098 2.714.644.718 1.03 1.632 1.03 2.752 0 3.928-2.335 4.802-4.561 5.057.361.297.676 1.08.676 2.184 0 1.592-.012 2.876-.012 3.263 0 .273.18.598.688.493C17.138 18.627 20 14.783 20 10.253 20 4.59 15.522 0 10 0z" />
    </svg>
  )
}

/** GitLab tanuki mark. Source: SVG Repo. */
export function GitLabIcon({ className, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      className={cn('w-4 h-4', className)}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path fill="#FC6D26" d="M14.975 8.904L14.19 6.55l-1.552-4.67a.268.268 0 00-.255-.18.268.268 0 00-.254.18l-1.552 4.667H5.422L3.87 1.879a.267.267 0 00-.254-.179.267.267 0 00-.254.18l-1.55 4.667-.784 2.357a.515.515 0 00.193.583l6.78 4.812 6.778-4.812a.516.516 0 00.196-.583z" />
      <path fill="#E24329" d="M8 14.296l2.578-7.75H5.423L8 14.296z" />
      <path fill="#FC6D26" d="M8 14.296l-2.579-7.75H1.813L8 14.296z" />
      <path fill="#FCA326" d="M1.81 6.549l-.784 2.354a.515.515 0 00.193.583L8 14.3 1.81 6.55z" />
      <path fill="#E24329" d="M1.812 6.549h3.612L3.87 1.882a.268.268 0 00-.254-.18.268.268 0 00-.255.18L1.812 6.549z" />
      <path fill="#FC6D26" d="M8 14.296l2.578-7.75h3.614L8 14.296z" />
      <path fill="#FCA326" d="M14.19 6.549l.783 2.354a.514.514 0 01-.193.583L8 14.296l6.188-7.747h.001z" />
      <path fill="#E24329" d="M14.19 6.549H10.58l1.551-4.667a.267.267 0 01.255-.18c.115 0 .217.073.254.18l1.552 4.667z" />
    </svg>
  )
}

/** Linear mark. Source: SVG Repo. */
export function LinearIcon({ className, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      className={cn('w-4 h-4', className)}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M3.03509 12.9431C3.24245 14.9227 4.10472 16.8468 5.62188 18.364C7.13904 19.8811 9.0631 20.7434 11.0428 20.9508L3.03509 12.9431Z" />
      <path d="M3 11.4938L12.4921 20.9858C13.2976 20.9407 14.0981 20.7879 14.8704 20.5273L3.4585 9.11548C3.19793 9.88771 3.0451 10.6883 3 11.4938Z" />
      <path d="M3.86722 8.10999L15.8758 20.1186C16.4988 19.8201 17.0946 19.4458 17.6493 18.9956L4.99021 6.33659C4.54006 6.89125 4.16573 7.487 3.86722 8.10999Z" />
      <path d="M5.66301 5.59517C9.18091 2.12137 14.8488 2.135 18.3498 5.63604C21.8508 9.13708 21.8645 14.8049 18.3907 18.3228L5.66301 5.59517Z" />
    </svg>
  )
}

/**
 * Render the appropriate platform icon based on the provider platform string.
 * Centralised entry point for all components that display provider icons.
 */
export function IssueProviderIcon({
  platform,
  className,
  ...props
}: { platform: IssueProviderPlatform } & IconProps): React.JSX.Element {
  switch (platform) {
    case 'github':
      return <GitHubIcon className={className} {...props} />
    case 'linear':
      return <LinearIcon className={className} {...props} />
    default:
      return <GitLabIcon className={className} {...props} />
  }
}
