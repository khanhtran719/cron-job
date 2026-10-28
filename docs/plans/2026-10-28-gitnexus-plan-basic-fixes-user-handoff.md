# Kế hoạch sửa lỗi cơ bản để bàn giao
> Task: Giữ nguyên luồng chức năng hiện tại, sửa lỗi nền tảng và chuẩn bị bộ chạy cho người nhận.
> Evidence: HEAD f732d01000a85598cb36ab3526ed4d3cdfefe3ef + 6 file unstaged; 17 file nguồn/cấu hình không đổi so với review trước.
> GitNexus: không có index repo; kế hoạch source-derived, tái dùng review và probe cách ly, không có bằng chứng graph/PDG.
> Provenance schema 2; global dirty digest 71d3fefaf621b8c52add8579145058979033eb76de575756f188596bfdb81fd7; 17 cited paths; chỉ loại trừ chính file kế hoạch.

## Objective (§1)
Sửa tối thiểu để bản hiện tại chạy rõ ràng, không đọc nhầm DB/chạy trùng, báo đúng kết quả và bàn giao tái lập được; chưa triển khai trong lượt này.

## Current Behaviour (§2–3)
- [verified, source-derived] src/index.ts:9–15 khởi tạo mọi branch, chạy repair HoaDon_Sub ngày 26–28/07/2026, cron tắt.
- [verified, source-derived] src/jobs/store-2-central.job.ts:22,44–62,183,333 đọc Store, ghi MASTER; ca/hóa đơn chỉ lấy ID; khách hàng/chi phí/doanh thu/phòng đang tắt.
- [verified, source-derived] ecosystem.config.js:6–7 chạy 4 worker; Dockerfile:33 dùng pm2-runtime index.js; docker-compose.yml:4 dùng image dựng sẵn.
- [verified, source-derived] Ba script thủ công có phạm vi riêng; central-2-master.ts:486–487 thực tế MASTER → CENTRAL; không suy diễn hướng từ tên file.
- [verified, source-derived] package.json có dev/build/start, chưa có test; tsconfig.json strict; typecheck và probe VM đã pass trong review trước.

## Findings (§4–5)
- [verified, source-derived] store-replication.ts:397,410 dùng KhanhHang/KhachHang khác nhau; destructure undefined trước try tại 359.
- [verified, source-derived] database.ts:105 dùng global sql.connect cho nhiều DB; probe VM đã chứng minh A/B nhận cùng pool; 94–97 map central nhầm master.
- [verified, source-derived] Job:150–155 bỏ lỗi ghi; caller:396 không kiểm tra; complain-replication.ts:301–302 vẫn completed/exit(0).
- [inferred, source-derived] Mất phân chia branch + UPDATE/INSERT không khóa tại job:132–141 có thể gây tranh chấp khi 4 worker cùng ghi.
- [verified, source-derived] cron.ts:8–12 trộn local/UTC; probe 03h/06h VN chọn lùi hai ngày. Cron hiện không hoạt động; quy tắc ngày kinh doanh chưa được xác nhận.

## Proposed Changes (§6)
1. src/scripts/store-replication.ts, metadata helpers: thống nhất KhachHang; kiểm tra cache/columns trước query; lỗi metadata phải có tên bảng và DB đích.
2. src/database.ts và ConnectionService trong ba script: dùng pool riêng theo cấu hình, map đúng centralPool, kiểm tra pool thực, đóng pool đúng lifecycle; chỉ yêu cầu kết nối cần cho tác vụ. Giữ nguyên biến môi trường và hướng nguồn/đích.
3. src/branch.ts, src/constant.ts, src/index.ts, job, ecosystem.config.js, Dockerfile: sửa cơ chế phân công branch nhất quán. PM2 4 worker chia đủ branch, Docker 1 worker xử lý toàn bộ; số worker phải khai báo rõ, không dùng mặc định 4 cho Docker một tiến trình.
4. src/jobs/store-2-central.job.ts và ba script: giữ cách tiếp tục xử lý các dòng/branch còn lại nhưng thu thập lỗi; cuối lượt có tổng đọc/ghi/lỗi và trạng thái thất bại nếu có lỗi. Chế độ một lần thoát nonzero sau cleanup; không tự process.exit trong hàm thư viện.
5. src/index.ts và lifecycle script: bắt bootstrap rejection, cleanup khi kết thúc tác vụ thủ công hoặc nhận signal; giữ pool nếu chạy lịch. Không thêm retry tự động trước khi chứng minh chạy lại an toàn.
6. package.json/package-lock.json: khai báo dependency runtime đang dùng trực tiếp như uuid/pm2 thay vì dựa vào dependency bắc cầu/global; giữ major hiện tại khi khả thi. Thêm lệnh rõ ràng cho các script và test.
7. README.md, .env.example, secret/branch.example.json, secret/old-branchs.example.json, .dockerignore, cấu hình đóng gói: hướng dẫn thiết lập, bảng hướng nguồn/đích và phạm vi ngày/bảng, lệnh build/chạy, đọc kết quả, nhận biết thất bại; chỉ chứa placeholder.
8. Dockerfile/docker-compose.yml: cung cấp đường build source vừa kiểm thử và phiên bản image xác định; giữ cách gọi entry phù hợp layout dist. Không ghi đè tag production hoặc phát hành từ lượt lập kế hoạch.

## Implementation Sequence (§7)
1. Viết test hồi quy cho typo, pool A/B, map Central, bootstrap error và lỗi ghi; dùng mocks, không DB thật.
2. Sửa lỗi script và kết nối, giữ nguyên chữ ký public khi được; cập nhật đủ bản sao liên quan, không refactor toàn bộ cùng lúc.
3. Sửa phân công worker và kiểm tra độ bao phủ branch ở cả 1/4 worker; không đổi số worker chỉ để che lỗi.
4. Bổ sung tổng kết kết quả/exit status và cleanup; giữ thứ tự xử lý và chế độ repair hiện tại.
5. Hoàn thiện dependency/lệnh chạy, example config, README và Docker; không đưa credential, logs, node_modules, .env hoặc secret thật vào bộ bàn giao.
6. Build/test sạch, chạy smoke cách ly; integration trên DB thử nghiệm riêng trước khi khẳng định end-to-end. Bàn giao source/revision, lockfile, ví dụ config, hướng dẫn và ghi chú kiểm chứng.

## Test Strategy (§8)
- Test mới test/*.test.cjs dùng node:test và mocks: sai cache không còn crash; metadata thiếu có lỗi rõ.
- Hai config DB khác nhau trả hai pool khác; central là central; pool chết không được coi vẫn kết nối chỉ vì cờ cache.
- Một worker xử lý mọi branch; bốn worker hợp lại đủ mọi branch và không trùng; instance ID/count sai phải báo lỗi.
- Target write lỗi: vẫn tổng hợp các phần còn lại, job báo có lỗi; script exit nonzero; không in thành công tuyệt đối.
- Snapshot tham số/phạm vi: vẫn giữ ngày, bảng, filter, hướng nguồn/đích và các bước đang tắt; dữ liệu rỗng hợp lệ không bị coi là lỗi.
- Chạy npm ci, npm run build và npm test sau khi thêm test script; kiểm tra production install và Docker build, chưa chạy entry vào DB thật.
- Integration có kiểm soát trên DB thử nghiệm: ghi mới, cập nhật, chạy lại cùng input, một dòng lỗi; đối soát count/key/giá trị và exit status.

## Implementation Context (§11)
```json
{
  "implementation_context": {
    "task_summary": "Sửa lỗi nền tảng để bàn giao, giữ nguyên phạm vi repair và các script hiện tại.",
    "evidence_provenance": {
      "schema_version": 2,
      "head_commit": "f732d01000a85598cb36ab3526ed4d3cdfefe3ef",
      "generated_plan_path": "docs/plans/2026-10-28-gitnexus-plan-basic-fixes-user-handoff.md",
      "global_dirty_digest": {
        "algorithm": "sha256",
        "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
        "value": "71d3fefaf621b8c52add8579145058979033eb76de575756f188596bfdb81fd7"
      },
      "cited_path_manifest": [
        {
          "path": "Dockerfile",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:a7b81f839a4bc0d2834d2c1685ab0dcd43d68cea1fb3b0488568baaad1b1ba7a",
          "index_digest": "sha256:a7b81f839a4bc0d2834d2c1685ab0dcd43d68cea1fb3b0488568baaad1b1ba7a",
          "worktree_digest": "sha256:a7b81f839a4bc0d2834d2c1685ab0dcd43d68cea1fb3b0488568baaad1b1ba7a",
          "untracked_digest": "absent"
        },
        {
          "path": "docker-compose.yml",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5570cdc9d675cfe9171fecd26bc818a584bb3af7d9bd63c8f547ac34d8e8b94a",
          "index_digest": "sha256:5570cdc9d675cfe9171fecd26bc818a584bb3af7d9bd63c8f547ac34d8e8b94a",
          "worktree_digest": "sha256:5570cdc9d675cfe9171fecd26bc818a584bb3af7d9bd63c8f547ac34d8e8b94a",
          "untracked_digest": "absent"
        },
        {
          "path": "ecosystem.config.js",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:29f320d059afb8248459dbc0051c1e3cc416033eb101b202e4d2bb733736d71e",
          "index_digest": "sha256:29f320d059afb8248459dbc0051c1e3cc416033eb101b202e4d2bb733736d71e",
          "worktree_digest": "sha256:29f320d059afb8248459dbc0051c1e3cc416033eb101b202e4d2bb733736d71e",
          "untracked_digest": "absent"
        },
        {
          "path": "package-lock.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:e68cfcb7c0d4bec47e748385e8988d421c30ba1cb3f54f9fb546822692287cae",
          "index_digest": "sha256:e68cfcb7c0d4bec47e748385e8988d421c30ba1cb3f54f9fb546822692287cae",
          "worktree_digest": "sha256:e68cfcb7c0d4bec47e748385e8988d421c30ba1cb3f54f9fb546822692287cae",
          "untracked_digest": "absent"
        },
        {
          "path": "package.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:86754e0815a4e6810d179c120c723b86a6470d05ab6c39306b57b9e56a5acdbc",
          "index_digest": "sha256:86754e0815a4e6810d179c120c723b86a6470d05ab6c39306b57b9e56a5acdbc",
          "worktree_digest": "sha256:86754e0815a4e6810d179c120c723b86a6470d05ab6c39306b57b9e56a5acdbc",
          "untracked_digest": "absent"
        },
        {
          "path": "src/branch.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:4c176f37ef736f564d9eaf658fd3daf3d7e1f022609acd0ab55fc93d08d7579d",
          "index_digest": "sha256:4c176f37ef736f564d9eaf658fd3daf3d7e1f022609acd0ab55fc93d08d7579d",
          "worktree_digest": "sha256:4c176f37ef736f564d9eaf658fd3daf3d7e1f022609acd0ab55fc93d08d7579d",
          "untracked_digest": "absent"
        },
        {
          "path": "src/constant.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:fbee69d6df35de4bd6d7af60465381f5be2da34006ce8c0e3683eba9c13f8f9c",
          "index_digest": "sha256:fbee69d6df35de4bd6d7af60465381f5be2da34006ce8c0e3683eba9c13f8f9c",
          "worktree_digest": "sha256:fbee69d6df35de4bd6d7af60465381f5be2da34006ce8c0e3683eba9c13f8f9c",
          "untracked_digest": "absent"
        },
        {
          "path": "src/cron.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:67e3253f25898be3d3d91335e4d9969a1ce44a2893505de0a65cd13d8abb291f",
          "index_digest": "sha256:67e3253f25898be3d3d91335e4d9969a1ce44a2893505de0a65cd13d8abb291f",
          "worktree_digest": "sha256:67e3253f25898be3d3d91335e4d9969a1ce44a2893505de0a65cd13d8abb291f",
          "untracked_digest": "absent"
        },
        {
          "path": "src/database.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "unstaged",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7c8ee36f552149746388d76d05ebf95be21f7417ba5b67538620cf549e32599d",
          "index_digest": "sha256:7c8ee36f552149746388d76d05ebf95be21f7417ba5b67538620cf549e32599d",
          "worktree_digest": "sha256:9d59824f039db66bd5cb30c19f39aead2c04940c5fc9b07c37166ed3e4f1de57",
          "untracked_digest": "absent"
        },
        {
          "path": "src/index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "unstaged",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:1bb3caaef7e2f2901415bb2c497de47ed9bf250af1fde7ca48812505faffc08f",
          "index_digest": "sha256:1bb3caaef7e2f2901415bb2c497de47ed9bf250af1fde7ca48812505faffc08f",
          "worktree_digest": "sha256:46226745d50c4b882cc45eb6ba28ad74d4aaba2e63598f76ff1880bf391aab2d",
          "untracked_digest": "absent"
        },
        {
          "path": "src/jobs/index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:8a76a3e15ac9d262035fc4cfdfbef7e623276474be9c7c3b9f1390bed2058ecc",
          "index_digest": "sha256:8a76a3e15ac9d262035fc4cfdfbef7e623276474be9c7c3b9f1390bed2058ecc",
          "worktree_digest": "sha256:8a76a3e15ac9d262035fc4cfdfbef7e623276474be9c7c3b9f1390bed2058ecc",
          "untracked_digest": "absent"
        },
        {
          "path": "src/jobs/store-2-central.job.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "unstaged",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5354c5e4692097545e70a618f44f4d9564c905e8b62b2fa21772616713d27e76",
          "index_digest": "sha256:5354c5e4692097545e70a618f44f4d9564c905e8b62b2fa21772616713d27e76",
          "worktree_digest": "sha256:516197c65e07e361b3bba958d15682a1905c23a2db3e41d4827aecf836a0279c",
          "untracked_digest": "absent"
        },
        {
          "path": "src/log.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:da587f345a5728a175ae4ef8df4e872256c1738ed5a971cbd4dd5db3da9cb91b",
          "index_digest": "sha256:da587f345a5728a175ae4ef8df4e872256c1738ed5a971cbd4dd5db3da9cb91b",
          "worktree_digest": "sha256:da587f345a5728a175ae4ef8df4e872256c1738ed5a971cbd4dd5db3da9cb91b",
          "untracked_digest": "absent"
        },
        {
          "path": "src/scripts/central-2-master.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "unstaged",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:94bb902aaf94156c1e43072dd103c436d79494ca06df8178710dae764f95704f",
          "index_digest": "sha256:94bb902aaf94156c1e43072dd103c436d79494ca06df8178710dae764f95704f",
          "worktree_digest": "sha256:d302231ae6569e506c84d18b832c4bfb0925a151f5d3650d30edcb1e209610ca",
          "untracked_digest": "absent"
        },
        {
          "path": "src/scripts/complain-replication.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "unstaged",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:6bd0923d087949765c544ae74ac9c58c8ce855528d899c9155cdbf9aa8bb7e30",
          "index_digest": "sha256:6bd0923d087949765c544ae74ac9c58c8ce855528d899c9155cdbf9aa8bb7e30",
          "worktree_digest": "sha256:14acc9fa04fde9eb13ab5fce24f36590ea8c822b3f2a2590f580917cfc92003f",
          "untracked_digest": "absent"
        },
        {
          "path": "src/scripts/store-replication.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "unstaged",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:c74228f4163355354f16411a96feb3d012a38b2849961e7ef995231bffa2d36f",
          "index_digest": "sha256:c74228f4163355354f16411a96feb3d012a38b2849961e7ef995231bffa2d36f",
          "worktree_digest": "sha256:07c00b68a1440e79fb3e09d50c6fee70190f0b07e1d27479bb2aaf821d50f55d",
          "untracked_digest": "absent"
        },
        {
          "path": "tsconfig.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:0b833a3541022d93bb2da9846a779cd2765a3d86d595ab1a4af28389cee23945",
          "index_digest": "sha256:0b833a3541022d93bb2da9846a779cd2765a3d86d595ab1a4af28389cee23945",
          "worktree_digest": "sha256:0b833a3541022d93bb2da9846a779cd2765a3d86d595ab1a4af28389cee23945",
          "untracked_digest": "absent"
        }
      ]
    },
    "files_to_modify": [
      {
        "file": "src/database.ts",
        "symbols": [
          "ConnectionService"
        ],
        "intended_change": "Pool riêng, map đúng, kiểm tra trạng thái và lifecycle."
      },
      {
        "file": "src/scripts/store-replication.ts",
        "symbols": [
          "ConnectionService",
          "customerReplication"
        ],
        "intended_change": "Sửa KhachHang cache, kết nối, kết quả và cleanup."
      },
      {
        "file": "src/scripts/central-2-master.ts",
        "symbols": [
          "ConnectionService",
          "rowInsertion"
        ],
        "intended_change": "Sửa pool/error/lifecycle; giữ hướng MASTER→CENTRAL."
      },
      {
        "file": "src/scripts/complain-replication.ts",
        "symbols": [
          "ConnectionService",
          "rowInsertion"
        ],
        "intended_change": "Tổng hợp lỗi/exit đúng, cleanup; giữ filter hiện có."
      },
      {
        "file": "src/jobs/store-2-central.job.ts",
        "symbols": [
          "HandleAsyncData",
          "rowInsertion"
        ],
        "intended_change": "Phân công branch nhất quán và trả kết quả lỗi rõ ràng."
      },
      {
        "file": "src/index.ts",
        "symbols": [
          "bootstrap"
        ],
        "intended_change": "Giữ repair, bắt lỗi và cleanup."
      },
      {
        "file": "src/branch.ts",
        "symbols": [
          "getInsBranchs"
        ],
        "intended_change": "Đủ và không trùng branch giữa worker."
      },
      {
        "file": "src/constant.ts",
        "symbols": [
          "INSTANCE_ID",
          "TOTAL_INSTANCES"
        ],
        "intended_change": "Xác định/validate worker count phù hợp từng đường chạy."
      },
      {
        "file": "package.json",
        "symbols": [],
        "intended_change": "Dependency, lệnh chạy, cấu hình hoặc tài liệu bàn giao tối thiểu; tệp mới nếu chưa tồn tại."
      },
      {
        "file": "package-lock.json",
        "symbols": [],
        "intended_change": "Dependency, lệnh chạy, cấu hình hoặc tài liệu bàn giao tối thiểu; tệp mới nếu chưa tồn tại."
      },
      {
        "file": "ecosystem.config.js",
        "symbols": [],
        "intended_change": "Dependency, lệnh chạy, cấu hình hoặc tài liệu bàn giao tối thiểu; tệp mới nếu chưa tồn tại."
      },
      {
        "file": "Dockerfile",
        "symbols": [],
        "intended_change": "Dependency, lệnh chạy, cấu hình hoặc tài liệu bàn giao tối thiểu; tệp mới nếu chưa tồn tại."
      },
      {
        "file": "docker-compose.yml",
        "symbols": [],
        "intended_change": "Dependency, lệnh chạy, cấu hình hoặc tài liệu bàn giao tối thiểu; tệp mới nếu chưa tồn tại."
      },
      {
        "file": "README.md",
        "symbols": [],
        "intended_change": "Dependency, lệnh chạy, cấu hình hoặc tài liệu bàn giao tối thiểu; tệp mới nếu chưa tồn tại."
      },
      {
        "file": ".env.example",
        "symbols": [],
        "intended_change": "Dependency, lệnh chạy, cấu hình hoặc tài liệu bàn giao tối thiểu; tệp mới nếu chưa tồn tại."
      },
      {
        "file": "secret/branch.example.json",
        "symbols": [],
        "intended_change": "Dependency, lệnh chạy, cấu hình hoặc tài liệu bàn giao tối thiểu; tệp mới nếu chưa tồn tại."
      },
      {
        "file": "secret/old-branchs.example.json",
        "symbols": [],
        "intended_change": "Dependency, lệnh chạy, cấu hình hoặc tài liệu bàn giao tối thiểu; tệp mới nếu chưa tồn tại."
      },
      {
        "file": ".dockerignore",
        "symbols": [],
        "intended_change": "Dependency, lệnh chạy, cấu hình hoặc tài liệu bàn giao tối thiểu; tệp mới nếu chưa tồn tại."
      }
    ],
    "tests": [
      {
        "file": "test/basic-fixes.test.cjs",
        "scenarios": [
          "metadata KhachHang thống nhất",
          "pool A và B khác nhau; Central đúng",
          "1/4 worker không thiếu/trùng branch",
          "ghi lỗi báo thất bại sau khi xử lý phần còn lại",
          "giữ nguyên repair params và script filters",
          "cleanup và bootstrap error"
        ]
      }
    ],
    "verification_commands": [
      "npm run build",
      "./node_modules/.bin/tsc --noEmit"
    ],
    "assumptions": [
      "Review source không đổi được xác nhận bằng fingerprint 17 file; snapshot helper đính kèm là binding chính thức.",
      "Lấy working tree hiện tại làm chuẩn hành vi; kiểm tra input/output parameters.",
      "Không có index/PDG; mọi finding là source-derived.",
      "npm test chưa tồn tại; phải thêm và chạy trong triển khai, không báo đã pass.",
      "Chưa có DB thử nghiệm hoặc môi trường người nhận để xác minh integration."
    ],
    "open_questions": [
      "Quy tắc ngày kinh doanh của cron trước khi bật hoặc sửa chọn ngày.",
      "Schema/constraint và quyền DB thực; cần fixture hoặc DB thử nghiệm.",
      "Môi trường chạy cuối cùng của người nhận; tài liệu phải phân biệt PM2/Docker."
    ],
    "avoid": [
      "Không sửa source/config/tests trong lượt lập kế hoạch.",
      "Không tự bật cron hoặc parent/customer/revenue/room replication.",
      "Không đổi ngày, bảng, filter hay hướng MASTER/CENTRAL mặc định.",
      "Không kết nối hoặc ghi DB thật, không phát hành image/production.",
      "Không thêm secrets vào plan/example/package.",
      "Không refactor lớn, đổi schema, queue, retry tự động hay nâng major ngoài phạm vi."
    ]
  }
}
```

## Assumptions and Open Questions (§12)
- [assumed] “Giữ nguyên luồng” lấy working tree đã review làm chuẩn; không tự bật cron, parent writes hay đổi MASTER/CENTRAL; kiểm tra bằng snapshot tham số trong test.
- [assumed] Quyền/schema DB người nhận tương thích; xác minh bằng preflight cấu hình và integration trên DB thử nghiệm, không dùng credential thật trong tài liệu.
- Người nhận chọn npm/PM2 hoặc Docker bằng hướng dẫn; cả hai đường phải đúng số worker. Môi trường/OS cụ thể chưa được cung cấp.
- Quy tắc ngày kinh doanh, đồng bộ xóa, identity/computed columns và chiến lược transaction/upsert đa tiến trình chưa được DB thực xác nhận.
- Hoãn sửa logic ngày cron cho đến khi rõ quy tắc; ghi rõ cron đang tắt và chưa được nghiệm thu. Không tự triển khai scheduler hoặc mở rộng bảng.
- Hoãn queue, checkpoint bền vững, tự retry, transaction nghiệp vụ lớn, phân tán lock và nâng major dependency; nếu kiểm thử chạy lại phát hiện lỗi khóa/dữ liệu thì giải quyết trước bàn giao.
- Không cần chạy lại khám phá toàn repo; nếu source thay đổi thì đọc lại đúng vùng liên quan và cập nhật bằng chứng.

## Definition of Done (§13)
- Luồng và phạm vi dữ liệu hiện tại được giữ nguyên; lỗi typo/pool/map được sửa; mỗi branch có đúng một worker xử lý trong cấu hình bàn giao.
- Không có lượt ghi lỗi bị báo thành công; có số liệu kết quả và exit code, cleanup đầy đủ; typecheck/build/test pass.
- Có bộ cấu hình mẫu không bí mật và hướng dẫn người nhận từ cài đặt đến chạy/đối soát; image/source cùng revision nếu bàn giao Docker.
- Báo rõ integration nào đã chạy/chưa chạy; chỉ khẳng định đã hoạt động end-to-end khi có kết quả DB thử nghiệm, không dùng passing mocks làm bằng chứng dữ liệu thật.
