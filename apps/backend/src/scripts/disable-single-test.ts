import fs from 'fs';
import path from 'path';

async function disableSingleTest() {
  console.log('🔒 DESACTIVANDO MODO PRUEBA ÚNICA');

  // Buscar .env en backend y en root (soporta cwd = root o apps/backend)
  const rawCandidates = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'apps/backend/.env'),
    path.resolve('apps/backend/.env'),
    path.resolve('.env'),
    path.join(path.dirname(process.cwd()), '.env'),
  ];
  const candidates = [...new Set(rawCandidates)];

  let envPath: string | null = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      envPath = p;
      break;
    }
  }

  if (!envPath || !fs.existsSync(envPath)) {
    // No existe .env (solo .env.example) → crear .env mínimo con modo desactivado
    const target = path.join(process.cwd(), '.env');
    const fallback = fs.existsSync(path.join(process.cwd(), '.env.example')) ? target : path.join(process.cwd(), 'apps/backend/.env');
    console.warn(`⚠️ No se encontró .env, creando uno nuevo en ${target} con modo prueba DESACTIVADO`);
    envPath = target;
    // Si existe .env.example, copiar base
    const examplePath = path.join(path.dirname(target), '.env.example');
    if (fs.existsSync(examplePath)) {
      let content = fs.readFileSync(examplePath, 'utf8');
      content += `\nSINGLE_TEST_MODE=false\nALLOW_DIRECT_IP=false\nMAX_TEST_EXECUTIONS=1\nTEST_URL=https://www.livescore.com\n`;
      fs.writeFileSync(envPath, content);
    } else {
      fs.writeFileSync(envPath, `SINGLE_TEST_MODE=false\nALLOW_DIRECT_IP=false\nMAX_TEST_EXECUTIONS=1\nTEST_URL=https://www.livescore.com\nPROXY_ENABLED=true\n`);
    }
    console.log(`✅ .env creado en ${envPath} con SINGLE_TEST_MODE=false`);
    return;
  }

  let envContent = fs.readFileSync(envPath, 'utf8');

  // Desactivar modo prueba
  envContent = envContent.replace(/SINGLE_TEST_MODE=true/g, 'SINGLE_TEST_MODE=false');
  envContent = envContent.replace(/ALLOW_DIRECT_IP=true/g, 'ALLOW_DIRECT_IP=false');
  // Reactivar proxies si estaba deshabilitado para la prueba
  if (envContent.includes('PROXY_ENABLED=false')) {
    envContent = envContent.replace(/PROXY_ENABLED=false/g, 'PROXY_ENABLED=true');
  }

  fs.writeFileSync(envPath, envContent);

  console.log(`✅ Modo prueba única DESACTIVADO en ${envPath}`);
  console.log('✅ Proxies REACTIVADOS (PROXY_ENABLED=true)');
  console.log('🔴 El sistema ahora usa proxies nuevamente');
  console.log('🔒 SINGLE_TEST_MODE=false, ALLOW_DIRECT_IP=false');
}

disableSingleTest();
