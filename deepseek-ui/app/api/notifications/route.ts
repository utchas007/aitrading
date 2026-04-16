import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { apiError } from '@/lib/api-response';
import { withCorrelation } from '@/lib/correlation';
import { validate, markNotificationSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/notifications — fetch recent notifications
export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const notifications = await prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, createdAt: true, type: true, title: true, message: true, pair: true, read: true },
      });
      const unreadCount = await prisma.notification.count({ where: { read: false } });
      return NextResponse.json({ success: true, notifications, unreadCount });
    } catch (error: any) {
      return apiError(error.message, 'DB_ERROR');
    }
  });
}

// POST /api/notifications — create or bulk-mark-read
export async function POST(req: NextRequest) {
  return withCorrelation(req, async () => {
    try {
      const rawBody = await req.json();
      const parsed = validate(rawBody, markNotificationSchema);
      if ('errorResponse' in parsed) return parsed.errorResponse;
      const body = parsed.data;

      // Mark all as read
      if ('action' in body && body.action === 'markAllRead') {
        await prisma.notification.updateMany({ where: { read: false }, data: { read: true } });
        return NextResponse.json({ success: true });
      }

      // Mark one as read
      if ('action' in body && body.action === 'markRead') {
        await prisma.notification.update({ where: { id: body.id }, data: { read: true } });
        return NextResponse.json({ success: true });
      }

      // Create a new notification
      const { type, title, message, pair } = body as { type: string; title: string; message: string; pair?: string };
      const notification = await prisma.notification.create({
        data: { type, title, message, pair: pair ?? null },
      });
      return NextResponse.json({ success: true, notification });
    } catch (error: any) {
      return apiError(error.message, 'DB_ERROR');
    }
  });
}
