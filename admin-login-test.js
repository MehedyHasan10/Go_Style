import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

// ======================================================
// ENVIRONMENT
// ======================================================

const BASE_URL =
  __ENV.BASE_URL || "https://admin.gostyle.uk";

const EMAIL = __ENV.EMAIL;
const PASSWORD = __ENV.PASSWORD;

const LOGIN_PATH =
  __ENV.LOGIN_PATH || "/api/auth/login";

// ======================================================
// CUSTOM METRICS
// ======================================================

const roles200 = new Counter("roles_200");
const roles429 = new Counter("roles_429");
const rolesOtherErrors = new Counter("roles_other_errors");

const rolesSuccessRate = new Rate("roles_success_rate");
const roles429Rate = new Rate("roles_429_rate");

// ======================================================
// LOAD CONFIGURATION
// ======================================================

export const options = {
  stages: [
    // Ramp from 0 to 10 users
    {
      duration: "20s",
      target: 10,
    },

    // Keep 10 concurrent users
    {
      duration: "1m",
      target: 10,
    },

    // Ramp down
    {
      duration: "20s",
      target: 0,
    },
  ],

  thresholds: {
    // 95% of Roles requests should complete under 1 second
    "http_req_duration{name:GET Roles}": [
      "p(95)<1000",
    ],

    // More than 99% should succeed
    roles_success_rate: [
      "rate>0.99",
    ],

    // Less than 1% should receive HTTP 429
    roles_429_rate: [
      "rate<0.01",
    ],
  },
};

// ======================================================
// LOGIN ONCE
// ======================================================

export function setup() {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "EMAIL or PASSWORD environment variable is missing."
    );
  }

  console.log("======================================");
  console.log("Logging in ONCE before load test...");
  console.log("======================================");

  const loginResponse = http.post(
    `${BASE_URL}${LOGIN_PATH}`,
    JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
    }),
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },

      redirects: 0,

      tags: {
        name: "POST Login Setup",
      },
    }
  );

  console.log(
    `LOGIN STATUS = ${loginResponse.status}`
  );

  const loginSuccessful = check(loginResponse, {
    "setup login successful": (r) =>
      r.status === 200 ||
      r.status === 201 ||
      r.status === 204,
  });

  if (!loginSuccessful) {
    console.error(
      `LOGIN FAILED | STATUS=${loginResponse.status}`
    );

    console.error(
      `LOGIN BODY=${loginResponse.body.substring(0, 300)}`
    );

    throw new Error(
      "Login failed. Load test stopped."
    );
  }

  // ====================================================
  // TRY TO GET TOKEN
  // ====================================================

  let token = null;

  try {
    const body = loginResponse.json();

    token =
      body.accessToken ||
      body.access_token ||
      body.token ||
      body.data?.accessToken ||
      body.data?.access_token ||
      body.data?.token ||
      null;
  } catch (error) {
    // This application may use session cookies.
  }

  // ====================================================
  // GET SESSION COOKIE
  // ====================================================

  const cookies = [];

  for (const name in loginResponse.cookies) {
    const values = loginResponse.cookies[name];

    if (
      values &&
      values.length > 0 &&
      values[0].value
    ) {
      cookies.push(
        `${name}=${values[0].value}`
      );
    }
  }

  const cookieHeader = cookies.join("; ");

  if (token) {
    console.log(
      "Authentication type: Bearer Token"
    );
  } else if (cookieHeader) {
    console.log(
      "Authentication type: Session Cookie"
    );
  } else {
    console.log(
      "WARNING: No authentication token/cookie detected."
    );
  }

  console.log(
    "Login complete. Starting 10 VU load test..."
  );

  return {
    token,
    cookie: cookieHeader,
  };
}

// ======================================================
// LOAD TEST
// ======================================================

export default function (auth) {
  const headers = {
    Accept: "application/json",
  };

  // Bearer token
  if (auth.token) {
    headers.Authorization =
      `Bearer ${auth.token}`;
  }

  // Session cookie
  if (auth.cookie) {
    headers.Cookie = auth.cookie;
  }

  // ====================================================
  // GET ROLES
  // ====================================================

  const response = http.get(
    `${BASE_URL}/api/roles`,
    {
      headers,

      redirects: 0,

      tags: {
        name: "GET Roles",
      },
    }
  );

  // ====================================================
  // COUNT HTTP STATUS
  // ====================================================

  if (response.status === 200) {
    roles200.add(1);

    rolesSuccessRate.add(true);
    roles429Rate.add(false);
  }

  else if (response.status === 429) {
    roles429.add(1);

    rolesSuccessRate.add(false);
    roles429Rate.add(true);
  }

  else {
    rolesOtherErrors.add(1);

    rolesSuccessRate.add(false);
    roles429Rate.add(false);

    console.error(
      `UNEXPECTED STATUS = ${response.status}`
    );
  }

  // ====================================================
  // CHECK RESPONSE
  // ====================================================

  check(response, {
    "roles status is 200": (r) =>
      r.status === 200,

    "roles response under 1 second": (r) =>
      r.timings.duration < 1000,

    "roles response is JSON": (r) => {
      if (r.status !== 200) {
        return false;
      }

      const contentType =
        r.headers["Content-Type"] || "";

      return contentType.includes(
        "application/json"
      );
    },

    "roles items returned": (r) => {
      if (r.status !== 200) {
        return false;
      }

      try {
        const body = r.json();

        return Array.isArray(body.items);
      } catch (error) {
        return false;
      }
    },
  });

  // ====================================================
  // USER THINK TIME
  // ====================================================

  // Each VU waits 1 second before next request.
  sleep(1);
}

// ======================================================
// FINAL SUMMARY
// ======================================================

export function handleSummary(data) {
  const total200 =
    data.metrics.roles_200?.values?.count || 0;

  const total429 =
    data.metrics.roles_429?.values?.count || 0;

  const totalOther =
    data.metrics.roles_other_errors?.values?.count || 0;

  const total =
    total200 +
    total429 +
    totalOther;

  const successPercent =
    total > 0
      ? ((total200 / total) * 100).toFixed(2)
      : "0.00";

  const rateLimitPercent =
    total > 0
      ? ((total429 / total) * 100).toFixed(2)
      : "0.00";

  console.log("");
  console.log("======================================");
  console.log("       GOSTYLE LOAD TEST RESULT");
  console.log("======================================");

  console.log(
    `Concurrent Users : 10`
  );

  console.log(
    `Total Requests   : ${total}`
  );

  console.log(
    `HTTP 200         : ${total200}`
  );

  console.log(
    `HTTP 429         : ${total429}`
  );

  console.log(
    `Other Errors     : ${totalOther}`
  );

  console.log(
    `Success Rate     : ${successPercent}%`
  );

  console.log(
    `429 Rate         : ${rateLimitPercent}%`
  );

  console.log("======================================");

  return {
    stdout: JSON.stringify(data, null, 2),
  };
}