import { parseSSEResponse } from '~utils/sse'
import { AbstractBot, SendMessageParams } from '../abstract-bot'
import { createConversation, fetchOrganizationId, generateChatTitle } from './api'
import { requestHostPermission } from '~app/utils/permissions'
import { ChatError, ErrorCode } from '~utils/errors'

interface ConversationContext {
  conversationId: string
}

export class ClaudeWebBot extends AbstractBot {
  private organizationId?: string
  private conversationContext?: ConversationContext
  // private model: string

  constructor() {
    super()
    // default: claude3 Sonnet
    // this.model = 'claude-2.1'
  }

  async doSendMessage(params: SendMessageParams): Promise<void> {
    if (!(await requestHostPermission('https://*.claude.ai/'))) {
      throw new ChatError('Missing claude.ai permission', ErrorCode.MISSING_HOST_PERMISSION)
    }

    if (!this.organizationId) {
      this.organizationId = await fetchOrganizationId()
    }

    if (!this.conversationContext) {
      const conversationId = await createConversation(this.organizationId)
      this.conversationContext = { conversationId }
      generateChatTitle(this.organizationId, conversationId, params.prompt).catch(console.error)
    }

    const completionUrl = `https://claude.ai/api/organizations/${this.organizationId}/chat_conversations/${this.conversationContext.conversationId}/completion`

    const resp = await fetch(completionUrl, {
      method: 'POST',
      signal: params.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: params.prompt,
        attachments: [],
        files: [],
      }),
    })

    // different models are available for different accounts
    // if (!resp.ok && resp.status === 403 && this.model === 'claude-2.1') {
    //   if ((await resp.text()).includes('model_not_allowed')) {
    //     this.model = 'claude-2.0'
    //     return this.doSendMessage(params)
    //   }
    // }

    let result = ''

    await parseSSEResponse(resp, (message) => {
      console.debug('claude sse message', message)
      const payload = JSON.parse(message)
      if (payload.completion) {
        result += payload.completion
        params.onEvent({
          type: 'UPDATE_ANSWER',
          data: { text: result.trimStart() },
        })
      } else if (payload.error) {
        throw new Error(JSON.stringify(payload.error))
      }
    })

    params.onEvent({ type: 'DONE' })
  }

  resetConversation() {
    this.conversationContext = undefined
  }

  get name() {
    return 'Claude (webapp/claude-2)'
  }
}
