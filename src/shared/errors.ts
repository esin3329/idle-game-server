export class AppError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource}을(를) 찾을 수 없습니다.`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400, 'BAD_REQUEST');
    this.name = 'BadRequestError';
  }
}

export class InsufficientResourceError extends AppError {
  constructor(resource: string, required: number, current: number) {
    super(
      `${resource}이(가) 부족합니다.`,
      400,
      'INSUFFICIENT_RESOURCE',
    );
    this.name = 'InsufficientResourceError';
  }
}

export class InternalError extends AppError {
  constructor(message = '서버 내부 오류가 발생했습니다.') {
    super(message, 500, 'INTERNAL_ERROR');
    this.name = 'InternalError';
  }
}
