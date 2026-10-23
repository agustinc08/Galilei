import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule } from './swagger/swagger.module'; // Ajusta la ruta según tu estructura de carpetas

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  SwaggerModule.setup('swagger', app); // Agregar configuración de Swagger

  await app.listen(5000);
}
bootstrap();
