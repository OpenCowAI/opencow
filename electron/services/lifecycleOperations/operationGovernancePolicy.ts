// SPDX-License-Identifier: Apache-2.0

import type {
  SessionLifecycleOperationConfirmationMode,
  SessionLifecycleOperationProposalInput,
} from '../../../src/shared/types'
import type {
  ExplicitNoConfirmDetectionResult,
} from './explicitNoConfirmDetector'

/**
 * Central confirmation governance:
 * - default required
 * - allow auto execution only when explicit-no-confirm is high confidence
 */
export class OperationGovernancePolicy {
  resolveConfirmationMode(params: {
    proposal: SessionLifecycleOperationProposalInput
    noConfirmDetection: ExplicitNoConfirmDetectionResult
  }): SessionLifecycleOperationConfirmationMode {
    const requested = params.proposal.confirmationMode
    if (requested !== 'auto_if_user_explicit') return 'required'

    if (params.noConfirmDetection.explicitNoConfirm && params.noConfirmDetection.confidence === 'high') {
      return 'auto_if_user_explicit'
    }

    return 'required'
  }
}
