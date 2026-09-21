import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

// ======================================================
// CONFIG
// ======================================================

const BASE_URL =
  __ENV.BASE_URL || "https://admin.gostyle.uk";

const EMAIL = __ENV.EMAIL;

// Use an intentionally WRONG password.
// Do not use your real admin password for this test.
const WRONG_PASSWORD =
  __ENV.WRONG_PASSWORD || "InvalidSecurityTestPassword123!";

const LOGIN_PATH =
  __ENV.LOGIN_PATH || "/api/auth/login";

// ======================================================
// METRICS
// ======================================================

const unauthorized401 = new Counter("login_401");
const forbidden403 = new Counter("login_403");
const rateLimited429 = new Counter("login_429");
const unexpectedResponses = new Counter(
  "login_unexpected"
);

// ======================================================
// SECURITY TEST CONFIGURATION
// ======================================================

export const options = {
  scenarios: {
    brute_force_protection: {
      executor: "shared-iterations",

      // Controlled security test
      vus: 1,

      // Send only 10 failed login attempts
      iterations: 10,

      maxDuration: "1m",
    },
  },
};

// ======================================================
// TEST
// ======================================================

export default function () {
  if (!EMAIL) {
    throw new Error(
      "EMAIL environment variable is missing."
    );
  }

  const response = http.post(
    `${BASE_URL}${LOGIN_PATH}`,
    JSON.stringify({
      email: EMAIL,
      password: WRONG_PASSWORD,
    }),
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },

      redirects: 0,

      tags: {
        name: "Admin Login Security Test",
      },
    }
  );

  // ====================================================
  // DISPLAY RESULT
  // ====================================================

  console.log(
    `Attempt ${__ITER + 1} -> HTTP ${response.status}`
  );

  // ====================================================
  // STATUS COUNTERS
  // ====================================================

  if (response.status === 401) {
    unauthorized401.add(1);
  }

  else if (response.status === 403) {
    forbidden403.add(1);
  }

  else if (response.status === 429) {
    rateLimited429.add(1);

    console.log(
      `RATE LIMIT ACTIVE at attempt ${__ITER + 1}`
    );
  }

  else {
    unexpectedResponses.add(1);

    console.log(
      `Unexpected HTTP status: ${response.status}`
    );
  }

  // ====================================================
  // SECURITY CHECKS
  // ====================================================

  check(response, {
    // Wrong credentials must NEVER authenticate
    "invalid password cannot login": (r) =>
      r.status !== 200 &&
      r.status !== 201 &&
      r.status !== 204,

    // Server should use an authentication/rate-limit response
    "security response received": (r) =>
      r.status === 400 ||
      r.status === 401 ||
      r.status === 403 ||
      r.status === 429,

    // Response should not expose the submitted password
    "password not exposed": (r) =>
      !String(r.body).includes(WRONG_PASSWORD),
  });

  // Controlled interval between attempts
  sleep(1);
}

// ======================================================
// SUMMARY
// ======================================================

export function handleSummary(data) {
  const count401 =
    data.metrics.login_401?.values?.count || 0;

  const count403 =
    data.metrics.login_403?.values?.count || 0;

  const count429 =
    data.metrics.login_429?.values?.count || 0;

  const unexpected =
    data.metrics.login_unexpected?.values?.count || 0;

  console.log("");
  console.log("========================================");
  console.log("     ADMIN LOGIN SECURITY TEST");
  console.log("========================================");

  console.log(`HTTP 401       : ${count401}`);
  console.log(`HTTP 403       : ${count403}`);
  console.log(`HTTP 429       : ${count429}`);
  console.log(`Unexpected     : ${unexpected}`);

  if (count429 > 0) {
    console.log(
      "RESULT         : Rate limiting detected"
    );

    console.log(
      "SECURITY       : Brute-force protection active"
    );
  } else {
    console.log(
      "RESULT         : No HTTP 429 detected"
    );

    console.log(
      "SECURITY       : Review configured login attempt limit"
    );
  }

  console.log("========================================");

  return {
    stdout: JSON.stringify(data, null, 2),
  };
}