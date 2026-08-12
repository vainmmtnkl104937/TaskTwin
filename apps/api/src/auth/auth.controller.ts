import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from './auth.service.js';
import type {
  AuthenticatedUser,
  LoginResponse,
  RegisterResponse,
  SafeUserResponse,
} from './auth.types.js';
import { CurrentUser } from './current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { ScopedThrottle } from '../http-security/scoped-throttle.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ScopedThrottle('registration')
  register(@Body() input: RegisterDto): Promise<RegisterResponse> {
    return this.authService.register(input);
  }

  @Post('login')
  @ScopedThrottle('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() input: LoginDto): Promise<LoginResponse> {
    return this.authService.login(input);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ user: SafeUserResponse }> {
    return { user: await this.authService.getCurrentUser(user.id) };
  }
}
