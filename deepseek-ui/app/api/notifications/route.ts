import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/notifications — fetch recent notifications
export async function GET() {
  try {
    const notifications = await prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const unreadCount = await prisma.notification.count({ where: { read: false } });
    return NextResponse.json({ success: true, notifications, unreadCount });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/notifications — create or bulk-mark-read
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Mark all as read
    if (body.action === 'markAllRead') {
      await prisma.notification.updateMany({ where: { read: false }, data: { read: true } });
      return NextResponse.json({ success: true });
    }

    // Mark one as read
    if (body.action === 'markRead' && body.id) {
      await prisma.notification.update({ where: { id: body.id }, data: { read: true } });
      return NextResponse.json({ success: true });
    }

    // Create a new notification
    const { type, title, message, pair } = body;
    if (!type || !title || !message) {
      return NextResponse.json({ success: false, error: 'type, title, message required' }, { status: 400 });
    }
    const notification = await prisma.notification.create({
      data: { type, title, message, pair: pair ?? null },
    });
    return NextResponse.json({ success: true, notification });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
