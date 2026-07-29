import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { getJwtAccessConfiguration } from '../config/environment.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordHasher } from './password-hasher.js';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const configuration = getJwtAccessConfiguration();
        return {
          secret: configuration.secret,
          signOptions: {
            algorithm: 'HS256',
            expiresIn: configuration.expiresInSeconds,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PasswordHasher],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
