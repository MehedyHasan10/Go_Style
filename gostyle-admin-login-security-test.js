import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

// ======================================================
// CONFIG
// ======================================================

const BASE_URL =
  __ENV.BASE_URL || "https://admin.gostyle.uk";

const EMAIL = __ENV.EMAIL;

// Intentionally WRONG password.
// Do not use the real admin password for this test.
const WRONG_PASSWORD =
  __ENV.WRONG_PASSWORD ||
  "InvalidSecurityTestPassword123!";

const LOGIN_PATH =
  __ENV.LOGIN_PATH || "/api/auth/login";

// ======================================================
// METRICS
// ======================================================

const unauthorized401 =
  new Counter("login_401");

const forbidden403 =
  new Counter("login_403");

const rateLimited429 =
  new Counter("login_429");

const unexpectedResponses =
  new Counter("login_unexpected");

// ======================================================
// SECURITY TEST CONFIGURATION
// ======================================================

export const options = {
  scenarios: {
    brute_force_protection: {
      executor: "shared-iterations",

      // Controlled security test
      vus: 1,

      // Only 10 failed login attempts
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

  const attemptNumber = __ITER + 1;

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
    `Attempt ${attemptNumber} -> HTTP ${response.status}`
  );

  // ====================================================
  // STATUS COUNTERS
  // ====================================================

  if (response.status === 401) {
    unauthorized401.add(1);
  } else if (response.status === 403) {
    forbidden403.add(1);
  } else if (response.status === 429) {
    rateLimited429.add(1);

    console.log(
      `RATE LIMIT ACTIVE at attempt ${attemptNumber}`
    );
  } else {
    unexpectedResponses.add(1);

    console.log(
      `Unexpected HTTP status: ${response.status}`
    );
  }

  // ====================================================
  // SECURITY CHECKS
  // ====================================================

  check(response, {
    // Invalid credentials must never authenticate.
    "invalid password cannot login": (r) =>
      r.status !== 200 &&
      r.status !== 201 &&
      r.status !== 204,

    // Expected authentication / validation / rate-limit
    // responses.
    "security response received": (r) =>
      r.status === 400 ||
      r.status === 401 ||
      r.status === 403 ||
      r.status === 429,

    // Submitted password must not be reflected.
    "password not exposed": (r) =>
      !String(r.body || "").includes(
        WRONG_PASSWORD
      ),
  });

  // Controlled interval between attempts.
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
    data.metrics.login_unexpected
      ?.values?.count || 0;

  const total =
    count401 +
    count403 +
    count429 +
    unexpected;

  // ====================================================
  // RESPONSE TIME
  // ====================================================

  const duration =
    data.metrics.http_req_duration?.values;

  const avg =
    duration?.avg?.toFixed(2) || "0.00";

  const min =
    duration?.min?.toFixed(2) || "0.00";

  const med =
    duration?.med?.toFixed(2) || "0.00";

  const max =
    duration?.max?.toFixed(2) || "0.00";

  const p90 =
    duration?.["p(90)"]?.toFixed(2) ||
    "0.00";

  const p95 =
    duration?.["p(95)"]?.toFixed(2) ||
    "0.00";

  // ====================================================
  // CONSOLE SUMMARY
  // ====================================================

  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "       ADMIN LOGIN SECURITY TEST"
  );
  console.log(
    "========================================"
  );

  console.log(
    `Total Attempts   : ${total}`
  );

  console.log(
    `HTTP 401         : ${count401}`
  );

  console.log(
    `HTTP 403         : ${count403}`
  );

  console.log(
    `HTTP 429         : ${count429}`
  );

  console.log(
    `Unexpected       : ${unexpected}`
  );

  console.log(
    "----------------------------------------"
  );

  console.log(
    `Average Response : ${avg} ms`
  );

  console.log(
    `Minimum Response : ${min} ms`
  );

  console.log(
    `Median Response  : ${med} ms`
  );

  console.log(
    `Maximum Response : ${max} ms`
  );

  console.log(
    `P90 Response     : ${p90} ms`
  );

  console.log(
    `P95 Response     : ${p95} ms`
  );

  console.log(
    "----------------------------------------"
  );

  if (count429 > 0) {
    console.log(
      "RESULT           : HTTP 429 detected"
    );

    console.log(
      "OBSERVATION      : Rate limiting responded during this test"
    );
  } else {
    console.log(
      "RESULT           : No HTTP 429 detected"
    );

    console.log(
      "OBSERVATION      : Review the configured login-attempt/rate-limit policy"
    );
  }

  console.log(
    "----------------------------------------"
  );

  console.log(
    "HTML Report      : k6-security-report.html"
  );

  console.log(
    "JSON Report      : k6-security-summary.json"
  );

  console.log(
    "========================================"
  );

  // ====================================================
  // GENERATE REPORTS
  // ====================================================

  return {
    "k6-security-report.html":
      htmlReport(data),

    "k6-security-summary.json":
      JSON.stringify(data, null, 2),

    stdout:
      "\nGoStyle security test completed.\n" +
      `Total Attempts: ${total}\n` +
      `HTTP 401: ${count401}\n` +
      `HTTP 403: ${count403}\n` +
      `HTTP 429: ${count429}\n` +
      `Unexpected: ${unexpected}\n`,
  };
}