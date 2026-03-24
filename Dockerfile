FROM node:22-alpine

# 작업 디렉토리 설정
WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./

# npm 버그 해결을 위해 캐시 및 기존 모듈 삭제 후 클린 설치
RUN npm cache clean --force && rm -rf node_modules package-lock.json && npm install

# 소스 코드 복사
COPY . .

# 프로젝트 빌드 (Vite 프론트엔드 + esbuild 백엔드)
RUN npm run build

# 포트 노출 (서버가 3000번 포트를 사용함)
EXPOSE 3000

# 환경 변수 설정 (운영 환경)
ENV NODE_ENV=production
ENV PORT=3000

# 서버 실행
CMD ["npm", "start"]
