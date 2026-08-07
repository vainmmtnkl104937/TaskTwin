import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { MarkAllReadSchema, NotificationListQuerySchema } from './notifications.contracts.js';
import type { NotificationListResponse } from './notifications.contracts.js';
import { NotificationsService } from './notifications.service.js';

function parseBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
@Controller('me/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, unknown>): Promise<NotificationListResponse> {
    const parsed = NotificationListQuerySchema.safeParse({ ...query,
      unread: parseBoolean(query.unread),
      limit: query.limit === undefined ? undefined : Number(query.limit),
    });
    if (!parsed.success) throw new BadRequestException({ code: 'NOTIFICATION_QUERY_INVALID', message: 'Invalid notification query.' });
    try {
      return await this.service.list(user.id, parsed.data);
    } catch (error) {
      if (parsed.data.cursor !== undefined && error instanceof Error && error.message === 'invalid') {
        throw new BadRequestException({ code: 'NOTIFICATION_CURSOR_INVALID', message: 'Invalid notification cursor.' });
      }
      throw error;
    }
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser, @Query('workspaceId') workspaceId?: string) {
    if (workspaceId !== undefined && !/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new BadRequestException({ code: 'NOTIFICATION_QUERY_INVALID' });
    return this.service.unreadCount(user.id, workspaceId);
  }

  @Post(':notificationId/read') @HttpCode(200)
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('notificationId') id: string) {
    return this.service.markRead(user.id, id);
  }

  @Post('read-all') @HttpCode(200)
  markAllRead(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = MarkAllReadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'NOTIFICATION_BODY_INVALID', message: 'Invalid mark-all request.' });
    return this.service.markAllRead(user.id, new Date(parsed.data.cutoff));
  }
}
