import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SystemAdministratorGuard } from '../authorization/system-administrator.guard.js';
import { RunnerReleaseService } from './runner-release.service.js';

@Controller('runner-releases')
@UseGuards(JwtAuthGuard)
export class RunnerReleaseController {
  constructor(private readonly service: RunnerReleaseService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('import')
  @UseGuards(SystemAdministratorGuard)
  import(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.service.import(user.id, input);
  }

  @Post(':id/deprecate')
  @UseGuards(SystemAdministratorGuard)
  deprecate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    return this.service.changeStatus(user.id, id, 'deprecated', input);
  }

  @Post(':id/block')
  @UseGuards(SystemAdministratorGuard)
  block(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    return this.service.changeStatus(user.id, id, 'blocked', input);
  }
}
