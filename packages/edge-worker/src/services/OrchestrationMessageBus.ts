import { LinearClient } from '@linear/sdk';
import { EventEmitter } from 'events';
import { OrchestrationService, type ChildSessionInfo } from './OrchestrationService.js';

/**
 * Message types for orchestration communication
 */
export enum MessageType {
  CHILD_ISSUE_CREATED = 'child_issue_created',
  CHILD_ISSUE_STARTED = 'child_issue_started',
  CHILD_ISSUE_COMPLETED = 'child_issue_completed',
  CHILD_ISSUE_FAILED = 'child_issue_failed',
  PARENT_DELEGATION = 'parent_delegation',
  PARENT_EVALUATION = 'parent_evaluation',
  ORCHESTRATION_COMPLETE = 'orchestration_complete'
}

/**
 * Message structure for orchestration communication
 */
export interface OrchestrationMessage {
  type: MessageType;
  parentIssueId: string;
  childIssueId?: string;
  agentSessionId?: string;
  payload: any;
  timestamp: Date;
}

/**
 * Configuration for the message bus
 */
export interface MessageBusConfig {
  linearClient: LinearClient;
  userAuthToken: string; // Required for cross-posting to trigger webhooks
  orchestrationService: OrchestrationService;
}

/**
 * Message bus for coordinating parent-child issue communication
 */
export class OrchestrationMessageBus extends EventEmitter {
  private linearClient: LinearClient;
  private userLinearClient: LinearClient;
  private orchestrationService: OrchestrationService;
  private messageQueue: OrchestrationMessage[] = [];
  private processing: boolean = false;

  constructor(config: MessageBusConfig) {
    super();
    this.linearClient = config.linearClient;
    this.userLinearClient = new LinearClient({ apiKey: config.userAuthToken });
    this.orchestrationService = config.orchestrationService;

    // Set up internal event handlers
    this.setupEventHandlers();
  }

  /**
   * Sets up internal event handlers for message processing
   */
  private setupEventHandlers(): void {
    // Handle child completion messages
    this.on(MessageType.CHILD_ISSUE_COMPLETED, async (message: OrchestrationMessage) => {
      await this.handleChildCompletion(message);
    });

    // Handle parent delegation messages
    this.on(MessageType.PARENT_DELEGATION, async (message: OrchestrationMessage) => {
      await this.handleParentDelegation(message);
    });
  }

  /**
   * Sends a message through the bus
   */
  async sendMessage(message: OrchestrationMessage): Promise<void> {
    // Add to queue
    this.messageQueue.push(message);
    
    // Emit the message event
    this.emit(message.type, message);
    
    // Process queue if not already processing
    if (!this.processing) {
      await this.processMessageQueue();
    }
  }

  /**
   * Processes queued messages
   */
  private async processMessageQueue(): Promise<void> {
    if (this.processing || this.messageQueue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          await this.processMessage(message);
        } catch (error) {
          console.error('Error processing message:', error);
          // Emit error event for monitoring
          this.emit('error', { message, error });
        }
      }
    }

    this.processing = false;
  }

  /**
   * Processes a single message
   */
  private async processMessage(message: OrchestrationMessage): Promise<void> {
    console.log(`Processing ${message.type} message for parent ${message.parentIssueId}`);
    
    // Message processing is handled by event handlers
    // This method can be extended for additional logging, metrics, etc.
  }

  /**
   * Handles child issue completion
   */
  private async handleChildCompletion(message: OrchestrationMessage): Promise<void> {
    const { parentIssueId, childIssueId, payload } = message;
    
    if (!childIssueId) {
      console.error('Child issue ID missing in completion message');
      return;
    }

    // Mark child as completed in orchestration service
    const orchestration = this.orchestrationService.markChildCompleted(
      childIssueId,
      payload.result || 'Completed'
    );

    if (!orchestration) {
      console.log(`No orchestration found for child issue ${childIssueId}`);
      return;
    }

    // Post result to parent issue's agent session using user auth token
    // This will trigger the parent agent to evaluate and continue
    await this.postToParentAgentSession(
      parentIssueId,
      orchestration.parentAgentSessionId,
      {
        type: 'child_completion',
        childIssueId,
        result: payload.result,
        summary: payload.summary,
        status: 'completed'
      }
    );

    // Check if all children are completed
    const allChildrenCompleted = Array.from(orchestration.childSessionMappings.values())
      .every((child: ChildSessionInfo) => child.status === 'completed');

    if (allChildrenCompleted) {
      // Send orchestration complete message
      await this.sendMessage({
        type: MessageType.ORCHESTRATION_COMPLETE,
        parentIssueId,
        payload: {
          totalChildren: orchestration.childIssueIds.length,
          results: Array.from(orchestration.childSessionMappings.values())
            .map((child: ChildSessionInfo) => ({
              issueId: child.issueId,
              result: child.result,
              completedAt: child.completedAt
            }))
        },
        timestamp: new Date()
      });
    }
  }

  /**
   * Handles parent delegation to create/assign child issues
   */
  private async handleParentDelegation(message: OrchestrationMessage): Promise<void> {
    const { parentIssueId, payload } = message;
    
    if (!payload.childIssueData) {
      console.error('Child issue data missing in delegation message');
      return;
    }

    try {
      // Create the child issue using Linear API
      const issue = await this.linearClient.createIssue({
        title: payload.childIssueData.title,
        description: payload.childIssueData.description,
        teamId: payload.childIssueData.teamId,
        labelIds: payload.childIssueData.labelIds,
        assigneeId: payload.childIssueData.assigneeId,
        parentId: parentIssueId // Link to parent if Linear supports it
      });

      const createdIssue = await issue;
      if (createdIssue && (createdIssue as any).id) {
        // Register the child issue in orchestration service
        this.orchestrationService.registerChildIssue(parentIssueId, (createdIssue as any).id);

        // Send creation confirmation
        await this.sendMessage({
          type: MessageType.CHILD_ISSUE_CREATED,
          parentIssueId,
          childIssueId: (createdIssue as any).id,
          payload: {
            issueNumber: (createdIssue as any).identifier,
            title: (createdIssue as any).title
          },
          timestamp: new Date()
        });

        console.log(`Created child issue ${(createdIssue as any).identifier} for parent ${parentIssueId}`);
      }
    } catch (error) {
      console.error('Failed to create child issue:', error);
      this.emit('error', { message, error });
    }
  }

  /**
   * Posts a message to a parent issue's agent session
   */
  private async postToParentAgentSession(
    _parentIssueId: string,
    agentSessionId: string,
    content: any
  ): Promise<void> {
    try {
      // Use user auth token to create a prompt activity
      // This will trigger the 'prompted' webhook for the parent agent
      const result = await (this.userLinearClient as any).client.request(`
        mutation CreateAgentActivityPrompt($input: AgentActivityCreatePromptInput!) {
          agentActivityCreatePrompt(input: $input) {
            success
            agentActivity {
              id
              type
              content
            }
          }
        }
      `, {
        input: {
          agentSessionId,
          content: {
            orchestrationMessage: true,
            ...content
          }
        }
      });

      if (result.agentActivityCreatePrompt?.success) {
        console.log(`Posted message to parent agent session ${agentSessionId}`);
      } else {
        console.error('Failed to post to parent agent session');
      }
    } catch (error) {
      console.error('Error posting to parent agent session:', error);
      throw error;
    }
  }

  /**
   * Notifies a child issue that it should start processing
   */
  async triggerChildIssueStart(
    parentIssueId: string,
    childIssueId: string,
    context: any
  ): Promise<void> {
    const orchestration = this.orchestrationService.getOrchestrationMapping(parentIssueId);
    if (!orchestration) {
      console.error(`No orchestration found for parent ${parentIssueId}`);
      return;
    }

    try {
      // Create a comment on the child issue to trigger agent processing
      // Use user auth token to ensure webhook fires
      const comment = await this.userLinearClient.createComment({
        issueId: childIssueId,
        body: `@cyrus Please process this sub-task.\n\nContext from parent:\n${JSON.stringify(context, null, 2)}`
      });

      if (comment.comment) {
        console.log(`Triggered processing for child issue ${childIssueId}`);
        
        // Send start message
        await this.sendMessage({
          type: MessageType.CHILD_ISSUE_STARTED,
          parentIssueId,
          childIssueId,
          payload: { context },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error(`Failed to trigger child issue ${childIssueId}:`, error);
      throw error;
    }
  }

  /**
   * Gets the current status of an orchestration
   */
  getOrchestrationStatus(parentIssueId: string): any {
    const orchestration = this.orchestrationService.getOrchestrationMapping(parentIssueId);
    if (!orchestration) {
      return null;
    }

    const childStatuses = Array.from(orchestration.childSessionMappings.values())
      .map((child: ChildSessionInfo) => ({
        issueId: child.issueId,
        status: child.status,
        result: child.result,
        completedAt: child.completedAt
      }));

    return {
      parentIssueId,
      status: orchestration.status,
      totalChildren: orchestration.childIssueIds.length,
      completedChildren: childStatuses.filter(c => c.status === 'completed').length,
      childStatuses
    };
  }

  /**
   * Cleans up old orchestrations
   */
  cleanup(hoursOld: number = 24): void {
    this.orchestrationService.cleanupOldOrchestrations(hoursOld);
    console.log(`Cleaned up orchestrations older than ${hoursOld} hours`);
  }
}