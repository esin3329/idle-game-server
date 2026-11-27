import { defineConfig } from 'vitest/config';

// Admin SPA 단위/스모크 테스트 전용 설정. 브라우저 API(fetch/localStorage)는 테스트에서 스텁한다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
