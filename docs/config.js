/*
 * 저장소 연결 설정. Supabase 프로젝트의 Settings → API에서 값을 복사해 넣는다.
 *
 * supabaseKey에는 공개용 키(anon 또는 publishable)만 넣는다.
 * service_role(secret) 키는 절대 넣지 않는다. 이 파일은 누구나 내려받을 수 있다.
 * 공개용 키로는 supabase/schema.sql의 정책에 따라 응답 추가만 가능하고 조회·수정·삭제는 불가능하다.
 *
 * 두 값이 비어 있으면 미리보기 모드로 동작하며, 제출 시 응답을 파일로 내려받는다.
 */
window.SURVEY_CONFIG = {
  supabaseUrl: "",   // 예: "https://abcdefghijklmnop.supabase.co"
  supabaseKey: "",   // 예: "sb_publishable_..." 또는 "eyJhbGciOi..." (anon)
  table: "survey_responses",
  contact: "",       // 제출 오류 시 안내할 연락처. 예: "name@example.ac.kr"
  previewOnly: false // true면 화면만 보여 주고 제출해도 저장하거나 내려받지 않는다
};
