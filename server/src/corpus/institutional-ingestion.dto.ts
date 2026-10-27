import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmInstitutionalMetadataDto {
  @IsString()
  @MaxLength(150)
  expediente!: string;

  @IsString()
  @MaxLength(100)
  sala!: string;

  @IsDateString({ strict: true })
  fecha!: string;

  @IsString()
  @MaxLength(500)
  caratula!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  numeroSentencia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tipoFallo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  tribunalOrigen?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  magistrados?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacionesInternas?: string;
}

export class LinkInstitutionalIngestionDto {
  @IsString()
  @MaxLength(30)
  sentenciaId!: string;
}
