// SPDX-License-Identifier: Apache-2.0

/**
 * RuleCreatorView — Scene-specific AI Creator for Rules.
 *
 * Thin wrapper around CapabilityCreatorView with rule-specific config.
 * Can be triggered via the UI "AI Create" button or future `/rule-creator` slash command.
 */

import { FileText } from 'lucide-react'
import {
  CapabilityCreatorView,
  type CapabilityCreatorConfig,
  type CapabilityCreatorExternalProps
} from './CapabilityCreatorView'

const RULE_CREATOR_CONFIG: CapabilityCreatorConfig = {
  category: 'rule',
  icon: FileText,
  iconColor: 'text-orange-500',
  iconGradient: 'bg-gradient-to-br from-orange-500/15 to-amber-500/10',
  i18nPrefix: 'capabilityCreator.rule',
  suggestionKeys: ['codingStandards', 'commitFormat', 'reviewGuidelines']
}

export function RuleCreatorView(props: CapabilityCreatorExternalProps): React.JSX.Element | null {
  return <CapabilityCreatorView config={RULE_CREATOR_CONFIG} {...props} />
}
