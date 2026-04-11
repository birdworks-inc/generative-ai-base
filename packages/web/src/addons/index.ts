// All in-house addons (chirp / quill / dashboard / rook / labeler / usermgmt)
// are now mounted in the Nest Portal addon registry.
// See generative-ai-addons/packages/nest-portal/web/src/addons/index.ts
//
// The GenU sidebar only shows the "← Nest" button (set via VITE_NEST_URL)
// to navigate back to the portal.
import './registry';
