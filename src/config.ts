/** 서버 기본 포트
 *
 * Dockerfile의 ARG PORT 기본값(3000)과 동기화 필요.
 * 변경 시 Dockerfile의 `ARG PORT=` 도 함께 수정.
 */
export const DEFAULT_PORT = 3000;
