import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/chat/history');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/chat/history - Get all conversations or specific one
 * GET /api/chat/history?id=123 - Get specific conversation with messages
 */
export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
  try {
    const id = req.nextUrl.searchParams.get('id');

    if (id) {
      // Get specific conversation with messages
      const conversation = await prisma.chatConversation.findUnique({
        where: { id: parseInt(id) },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!conversation) {
        return apiError('Conversation not found', 'NOT_FOUND', { status: 404 });
      }

      return NextResponse.json({ success: true, conversation });
    }

    // Get all conversations (without full messages, just metadata)
    const conversations = await prisma.chatConversation.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: {
        _count: { select: { messages: true } },
        messages: {
          take: 1,
          orderBy: { createdAt: 'asc' },
          select: { content: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      conversations: conversations.map(c => ({
        id: c.id,
        title: c.title || c.messages[0]?.content?.slice(0, 50) + '...' || 'New Chat',
        model: c.model,
        messageCount: c._count.messages,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    });
  } catch (error: any) {
    log.error('Chat history GET error', { error: error.message });
    return apiError(error.message, 'DB_ERROR');
  }
  });
}

/**
 * POST /api/chat/history - Create new conversation or add message
 * Body: { action: 'create', model: 'deepseek-r1:14b' }
 * Body: { action: 'message', conversationId: 123, role: 'user', content: '...', tokens?: 100 }
 * Body: { action: 'rename', conversationId: 123, title: 'New Title' }
 */
export async function POST(req: NextRequest) {
  return withCorrelation(req, async () => {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'create') {
      const conversation = await prisma.chatConversation.create({
        data: {
          model: body.model || 'deepseek-r1:14b',
          title: body.title || null,
        },
      });
      return NextResponse.json({ success: true, conversation });
    }

    if (action === 'message') {
      const { conversationId, role, content, tokens, error } = body;
      
      if (!conversationId || !role || !content) {
        return apiError('Missing required fields', 'VALIDATION_ERROR', { status: 400 });
      }

      const message = await prisma.chatMessage.create({
        data: {
          conversationId: parseInt(conversationId),
          role,
          content,
          tokens: tokens || null,
          error: error || false,
        },
      });

      // Update conversation's updatedAt and auto-generate title from first user message
      const conversation = await prisma.chatConversation.update({
        where: { id: parseInt(conversationId) },
        data: {
          updatedAt: new Date(),
          title: role === 'user' ? content.slice(0, 100) : undefined,
        },
      });

      return NextResponse.json({ success: true, message, conversation });
    }

    if (action === 'rename') {
      const { conversationId, title } = body;
      const conversation = await prisma.chatConversation.update({
        where: { id: parseInt(conversationId) },
        data: { title },
      });
      return NextResponse.json({ success: true, conversation });
    }

    return apiError('Invalid action', 'VALIDATION_ERROR', { status: 400 });
  } catch (error: any) {
    log.error('Chat history POST error', { error: error.message });
    return apiError(error.message, 'DB_ERROR');
  }
  });
}

/**
 * DELETE /api/chat/history?id=123 - Delete a conversation
 */
export async function DELETE(req: NextRequest) {
  return withCorrelation(req, async () => {
  try {
    const id = req.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError('ID required', 'VALIDATION_ERROR', { status: 400 });
    }

    await prisma.chatConversation.delete({
      where: { id: parseInt(id) },
    });

    return NextResponse.json({ success: true, deleted: parseInt(id) });
  } catch (error: any) {
    log.error('Chat history DELETE error', { error: error.message });
    return apiError(error.message, 'DB_ERROR');
  }
  });
}
