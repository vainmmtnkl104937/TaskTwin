import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class RegisterDto {
  @Transform(trimString)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  organizationName!: string;
}
