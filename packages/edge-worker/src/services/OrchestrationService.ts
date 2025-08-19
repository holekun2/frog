import { LinearClient } from '@linear/sdk';

/**
 * Represents a parent-child relationship between issues in an orchestration workflow
 */
export interface OrchestrationMapping {
  parentIssueId: string;
  parentAgentSessionId: string;
  parentCommentId?: string;
  childIssueIds: string[];
  childSessionMappings: Map<string, ChildSessionInfo>;
  status: 'active' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Information about a child issue and its agent session
 */
export interface ChildSessionInfo {
  issueId: string;
  agentSessionId?: string;
  commentId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * Service for managing parent-child issue orchestration relationships
 */
export class OrchestrationService {
  private orchestrationMappings: Map<string, OrchestrationMapping> = new Map();
  private issueToParentMap: Map<string, string> = new Map();
  private sessionToIssueMap: Map<string, string> = new Map();

  constructor(
    private linearClient: LinearClient,
    private userAuthToken?: string // Special token for cross-posting between issues
  ) {}

  /**
   * Creates a new orchestration mapping for a parent issue
   */
  createOrchestrationMapping(
    parentIssueId: string,
    parentAgentSessionId: string,
    parentCommentId?: string
  ): OrchestrationMapping {
    const mapping: OrchestrationMapping = {
      parentIssueId,
      parentAgentSessionId,
      parentCommentId,
      childIssueIds: [],
      childSessionMappings: new Map(),
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.orchestrationMappings.set(parentIssueId, mapping);
    return mapping;
  }

  /**
   * Registers a child issue under a parent orchestration
   */
  registerChildIssue(
    parentIssueId: string,
    childIssueId: string
  ): void {
    const mapping = this.orchestrationMappings.get(parentIssueId);
    if (!mapping) {
      throw new Error(`No orchestration mapping found for parent issue ${parentIssueId}`);
    }

    if (!mapping.childIssueIds.includes(childIssueId)) {
      mapping.childIssueIds.push(childIssueId);
    }

    const childInfo: ChildSessionInfo = {
      issueId: childIssueId,
      status: 'pending',
      createdAt: new Date()
    };

    mapping.childSessionMappings.set(childIssueId, childInfo);
    mapping.updatedAt = new Date();

    // Track reverse mapping
    this.issueToParentMap.set(childIssueId, parentIssueId);
  }

  /**
   * Updates the agent session information for a child issue
   */
  updateChildSession(
    childIssueId: string,
    agentSessionId: string,
    commentId?: string
  ): void {
    const parentIssueId = this.issueToParentMap.get(childIssueId);
    if (!parentIssueId) {
      // Not a child issue in any orchestration
      return;
    }

    const mapping = this.orchestrationMappings.get(parentIssueId);
    if (!mapping) {
      return;
    }

    const childInfo = mapping.childSessionMappings.get(childIssueId);
    if (childInfo) {
      childInfo.agentSessionId = agentSessionId;
      childInfo.commentId = commentId;
      childInfo.status = 'in_progress';
      mapping.updatedAt = new Date();

      // Track session to issue mapping
      this.sessionToIssueMap.set(agentSessionId, childIssueId);
    }
  }

  /**
   * Marks a child issue as completed and stores its result
   */
  markChildCompleted(
    childIssueId: string,
    result: string
  ): OrchestrationMapping | null {
    const parentIssueId = this.issueToParentMap.get(childIssueId);
    if (!parentIssueId) {
      return null;
    }

    const mapping = this.orchestrationMappings.get(parentIssueId);
    if (!mapping) {
      return null;
    }

    const childInfo = mapping.childSessionMappings.get(childIssueId);
    if (childInfo) {
      childInfo.status = 'completed';
      childInfo.result = result;
      childInfo.completedAt = new Date();
      mapping.updatedAt = new Date();
    }

    return mapping;
  }

  /**
   * Gets the parent issue ID for a given child issue
   */
  getParentIssueId(childIssueId: string): string | undefined {
    return this.issueToParentMap.get(childIssueId);
  }

  /**
   * Gets the orchestration mapping for a parent issue
   */
  getOrchestrationMapping(parentIssueId: string): OrchestrationMapping | undefined {
    return this.orchestrationMappings.get(parentIssueId);
  }

  /**
   * Gets the issue ID associated with an agent session
   */
  getIssueIdForSession(agentSessionId: string): string | undefined {
    return this.sessionToIssueMap.get(agentSessionId);
  }

  /**
   * Checks if an issue is a parent in an orchestration
   */
  isParentIssue(issueId: string): boolean {
    return this.orchestrationMappings.has(issueId);
  }

  /**
   * Checks if an issue is a child in an orchestration
   */
  isChildIssue(issueId: string): boolean {
    return this.issueToParentMap.has(issueId);
  }

  /**
   * Gets all active orchestrations
   */
  getActiveOrchestrations(): OrchestrationMapping[] {
    return Array.from(this.orchestrationMappings.values())
      .filter(m => m.status === 'active');
  }

  /**
   * Completes an orchestration when all child issues are done
   */
  completeOrchestration(parentIssueId: string): void {
    const mapping = this.orchestrationMappings.get(parentIssueId);
    if (mapping) {
      mapping.status = 'completed';
      mapping.updatedAt = new Date();
    }
  }

  /**
   * Posts a result from a child issue to the parent's agent session
   * This will trigger the parent agent to continue processing
   */
  async postChildResultToParent(
    childIssueId: string,
    result: string
  ): Promise<void> {
    const parentIssueId = this.issueToParentMap.get(childIssueId);
    if (!parentIssueId) {
      return;
    }

    const mapping = this.orchestrationMappings.get(parentIssueId);
    if (!mapping || !mapping.parentAgentSessionId) {
      return;
    }

    // Use the special user auth token to post as a user (triggering webhook)
    const client = this.userAuthToken 
      ? new LinearClient({ apiKey: this.userAuthToken })
      : this.linearClient;

    try {
      // Create a prompt activity in the parent's agent session
      await (client as any).client.request(`
        mutation CreateAgentActivityPrompt($input: AgentActivityCreatePromptInput!) {
          agentActivityCreatePrompt(input: $input) {
            success
            agentActivity {
              id
              type
            }
          }
        }
      `, {
        input: {
          agentSessionId: mapping.parentAgentSessionId,
          content: {
            message: `Sub-issue ${childIssueId} completed with result:\n\n${result}`,
            metadata: {
              sourceType: 'child_issue_completion',
              childIssueId,
              timestamp: new Date().toISOString()
            }
          }
        }
      });

      console.log(`Posted child result from ${childIssueId} to parent ${parentIssueId}`);
    } catch (error) {
      console.error(`Failed to post child result to parent:`, error);
      throw error;
    }
  }

  /**
   * Handles webhook events to track issue relationships
   */
  async handleWebhookForOrchestration(
    webhook: any
  ): Promise<void> {
    if ('agentSession' in webhook) {
      // Agent session event - update child session tracking
      const session = webhook.agentSession;
      
      if (session && session.issueId) {
        this.updateChildSession(
          session.issueId,
          session.id,
          session.commentId || undefined
        );
      }
    } else if ('__typename' in webhook && webhook.__typename === 'IssueWebhookPayload') {
      // Issue webhook - check for parent-child relationships
      // Check if this issue has a parent link in its description or relations
      // This would need to be implemented based on how parent-child relationships
      // are stored in Linear (e.g., through relations, custom fields, or description parsing)
    }
  }

  /**
   * Cleans up completed orchestrations older than specified hours
   */
  cleanupOldOrchestrations(hoursOld: number = 24): void {
    const cutoffTime = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
    
    for (const [issueId, mapping] of this.orchestrationMappings) {
      if (mapping.status === 'completed' && mapping.updatedAt < cutoffTime) {
        // Clean up child mappings
        for (const childId of mapping.childIssueIds) {
          this.issueToParentMap.delete(childId);
          const childInfo = mapping.childSessionMappings.get(childId);
          if (childInfo?.agentSessionId) {
            this.sessionToIssueMap.delete(childInfo.agentSessionId);
          }
        }
        
        // Remove the orchestration mapping
        this.orchestrationMappings.delete(issueId);
      }
    }
  }
}