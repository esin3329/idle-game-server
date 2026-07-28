import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'password',
    'passwordHash',
    'token',
    'accessToken',
    'refreshToken',
    'apiKey',
    'secret',
    '*.password',
    '*.token',
    '*.secret',
  ],
  base: {
    environment: process.env.NODE_ENV || 'development',
  },
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }),
});

/** 감사/보안 이벤트 전용 로거 */
export const auditLog = logger.child({ category: 'audit' });

/** 서비스별 로거 */
export const battleLog = logger.child({ service: 'battle' });
export const adminLog = logger.child({ service: 'admin' });
export const authLog = logger.child({ service: 'auth' });

/**
 * 보안 이벤트 기록 정책:
 * - JWT, Authorization, password, 전체 body는 저장하지 않음
 * - safeDetails는 { code, sessionId }만 허용
 * - 동일 이벤트 중복 기록: DB 레벨 제한 없음 (audit 로그로 선별)
 * - 기록 실패 시: 정상 사용자 요청에 영향 없음 (best effort)
 *   단, 재화·보상 관련 이벤트는 transaction 내에서 원자적으로 처리
 *
 * 향후 Prometheus 연동:
 *   - pino 메트릭을 prom-client Counter/Histogram으로 변환
 *   - GET /metrics 엔드포인트 추가 (prom-client.register.metrics())
 *   - http_requests_total{method,path,status}
 *   - http_request_duration_ms{method,path}
 *   - battle_sessions_total{status}
 *   - 현재는 Pino stdout을 vector → Prometheus remote_write로 연동
 */
