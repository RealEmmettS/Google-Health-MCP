"use client";

import { createAuthClient } from "better-auth/react";

// Same-origin client for the app's own pages (sign-in button, session state).
export const authClient = createAuthClient();
