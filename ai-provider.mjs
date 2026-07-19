const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 12000);
const AI_MAX_RETRIES = Number(process.env.AI_MAX_RETRIES ?? 1);

export async function generateStructuredQuery(question) {
  const messages = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: question }
  ];

  let attempts = 0;
  const llmStart = Date.now();
  let lastError;

  while (attempts <= AI_MAX_RETRIES) {
    attempts += 1;
    try {
      const raw = await callNvidia(messages);
      const cleaned = cleanJsonText(raw);
      return {
        query: JSON.parse(cleaned),
        meta: {
          attempts,
          llm_request_ms: Date.now() - llmStart
        }
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`LLM failed after ${attempts} attempt(s): ${lastError?.message ?? "unknown error"}`);
}

export async function generateExecutionPlan(question) {
  const messages = [
    { role: "system", content: executionPlanPrompt() },
    { role: "user", content: question }
  ];

  let attempts = 0;
  const llmStart = Date.now();
  let lastError;

  while (attempts <= AI_MAX_RETRIES) {
    attempts += 1;
    try {
      const raw = await callConfiguredProvider(messages, { json: true, maxTokens: 1200 });
      const cleaned = cleanJsonText(raw);
      return {
        plan: JSON.parse(cleaned),
        meta: {
          attempts,
          llm_request_ms: Date.now() - llmStart
        }
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Plan LLM failed after ${attempts} attempt(s): ${lastError?.message ?? "unknown error"}`);
}

export async function summarizeExecutionResults(question, plan, results) {
  const messages = [
    {
      role: "system",
      content: [
        "You write concise final answers for an employee analytics agent.",
        "Use only the supplied execution results.",
        "Do not invent names, departments, salaries, or counts.",
        "Do not expose raw JSON or MongoDB documents.",
        "Answer in natural language. Keep it short."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({ question, plan, results }, null, 2)
    }
  ];

  return callConfiguredProvider(messages, { json: false, maxTokens: 600 });
}

async function callConfiguredProvider(messages, options = {}) {
  const provider = String(process.env.AI_PROVIDER ?? "ollama").toLowerCase();
  if (provider === "ollama") {
    return callOllama(messages, options);
  }
  return callNvidia(messages, options);
}

async function callNvidia(messages, options = {}) {
  const apiKey = process.env.NVIDIA_API_KEY;
  const model = process.env.NVIDIA_MODEL ?? "google/gemma-4-31b-it";
  const baseUrl = process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com";
  const maxTokens = Number(options.maxTokens ?? process.env.NVIDIA_MAX_TOKENS ?? 150);
  const topP = Number(process.env.NVIDIA_TOP_P ?? 1);

  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY is required for AI_PROVIDER=nvidia");
  }

  const response = await fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0,
      top_p: topP,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
      ...(options.json === false ? {} : { response_format: { type: "json_object" } })
    })
  });

  if (!response.ok) {
    throw new Error(`NVIDIA failed with status ${response.status}`);
  }
  const body = await response.json();
  return String(body?.choices?.[0]?.message?.content ?? "");
}

async function callOllama(messages, options = {}) {
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";
  const chatPath = process.env.OLLAMA_CHAT_PATH ?? "/api/chat";

  const response = await fetchWithTimeout(`${host}${chatPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      format: options.json ? "json" : undefined,
      options: {
        temperature: 0,
        num_predict: options.maxTokens ?? 800
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama failed with status ${response.status}`);
  }

  const body = await response.json();
  return String(body?.message?.content ?? body?.response ?? "");
}

function cleanJsonText(text) {
  return String(text ?? "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function systemPrompt() {
  return [
    "You convert employee database questions into SAFE MongoDB query JSON.",
    "Return ONLY valid JSON.",
    "Do not return markdown or explanations.",
    "Primary collection: employees",
    "Related collections:",
    "- employee_attendance (employeeId:ObjectId, date:date, status:string, checkInHour:number|null, checkOutHour:number|null)",
    "- employee_payroll (employeeId:ObjectId, month:string, baseSalary:number, bonus:number, deductions:number, netSalary:number, currency:string, paidAt:date)",
    "- employee_reviews (employeeId:ObjectId, reviewDate:date, rating:number, goalsCompleted:number, reviewer:string, summary:string)",
    "Relationship: related collections join to employees via employeeId -> employees._id",
    "Employees fields: name, age, department, salary, city, joiningDate, remote",
    "Allowed operations: find, count, aggregate",
    "Allowed Mongo operators in filter: $eq, $gt, $gte, $lt, $lte, $regex, $options, $and, $or",
    "Never generate or imply: delete, drop, update, insert, create, remove, rename, eval, mapReduce, $where, $function, $accumulator",
    "If query is ambiguous, return: {\"operation\":\"clarify\",\"clarification_question\":\"...\"}",
    "Output schema:",
    "{\"operation\":\"find|count|aggregate|clarify\",\"filter\":{},\"projection\":{},\"sort\":{},\"limit\":number,\"pipeline\":[],\"clarification_question\":string|null}",
    "Rules:",
    "- By default, generate queries for employees collection unless user explicitly asks for attendance/payroll/review analytics.",
    "- count query: use operation=count, include only filter",
    "- aggregate query: use operation=aggregate and include pipeline",
    "- Use operation=aggregate when user asks for: averages, totals, grouping, statistics, counts by category, highest/lowest by group, analytics",
    "- For comparative analytics keywords (highest, lowest, youngest, oldest, maximum, minimum, top, bottom), prefer aggregate pipelines with $group/$sort/$limit when grouping is implied.",
    "- Allowed aggregate pipeline stages: $match, $group, $project, $sort, $limit",
    "- find query: include filter, optional projection/sort, limit <= 50 (default 25)",
    "- For 'starts with' use regex like ^A with $options:'i'",
    "- For ranges use $gte/$lte",
    "- For multi-condition use $and/$or",
    "Examples:",
    "- Which department has the youngest average employee age? => {\"operation\":\"aggregate\",\"pipeline\":[{\"$group\":{\"_id\":\"$department\",\"averageAge\":{\"$avg\":\"$age\"}}},{\"$sort\":{\"averageAge\":1}},{\"$limit\":1}]}",
    "- Which department has the highest average salary? => {\"operation\":\"aggregate\",\"pipeline\":[{\"$group\":{\"_id\":\"$department\",\"averageSalary\":{\"$avg\":\"$salary\"}}},{\"$sort\":{\"averageSalary\":-1}},{\"$limit\":1}]}",
    "- Which city has the lowest average salary? => {\"operation\":\"aggregate\",\"pipeline\":[{\"$group\":{\"_id\":\"$city\",\"averageSalary\":{\"$avg\":\"$salary\"}}},{\"$sort\":{\"averageSalary\":1}},{\"$limit\":1}]}",
    "- What is the average salary in each department? => {\"operation\":\"aggregate\",\"pipeline\":[{\"$group\":{\"_id\":\"$department\",\"averageSalary\":{\"$avg\":\"$salary\"}}}]}",
    "- How many employees are there in each city? => {\"operation\":\"aggregate\",\"pipeline\":[{\"$group\":{\"_id\":\"$city\",\"employeeCount\":{\"$sum\":1}}}]}",
    "- Show the top 5 highest paid employees. => {\"operation\":\"find\",\"filter\":{},\"sort\":{\"salary\":-1},\"limit\":5}",
    "- Show departments where average salary exceeds 90000. => {\"operation\":\"aggregate\",\"pipeline\":[{\"$group\":{\"_id\":\"$department\",\"averageSalary\":{\"$avg\":\"$salary\"}}},{\"$match\":{\"averageSalary\":{\"$gt\":90000}}}]}",
    "- Show cities where employee count exceeds 100. => {\"operation\":\"aggregate\",\"pipeline\":[{\"$group\":{\"_id\":\"$city\",\"employeeCount\":{\"$sum\":1}}},{\"$match\":{\"employeeCount\":{\"$gt\":100}}}]}",
    "- Find departments with average employee age below 30. => {\"operation\":\"aggregate\",\"pipeline\":[{\"$group\":{\"_id\":\"$department\",\"averageAge\":{\"$avg\":\"$age\"}}},{\"$match\":{\"averageAge\":{\"$lt\":30}}}]}"
  ].join("\n");
}

function executionPlanPrompt() {
  return [
    "You are an employee MCP execution planner.",
    "Return ONLY valid JSON. No markdown, prose, SQL, MongoDB, JavaScript, or comments.",
    "Schema: {\"steps\":[{\"tool\":\"approved_tool_name\",\"input\":{}}]}",
    "Only use approved tools listed below. Prefer the most specific tool. If a later step needs an earlier result, use variables like \"$step1.department\", \"$step1.name\", \"$step2.salary\".",
    "Use multi-step plans whenever intermediate reasoning is required.",
    "",
    "APPROVED TOOL CATALOG",
    "list_employees: returns employee rows with name, department, salary, age, city. Inputs: optional limit. Use for listing all employees.",
    "search_employee: returns employees whose names match query. Inputs: query. Use for employee search by partial name.",
    "get_employee_salary: returns name and salary. Inputs: employee. Use for one named employee salary.",
    "get_employee_department: returns name and department. Inputs: employee. Use for one named employee department.",
    "employees_by_department: returns employees in a department. Inputs: department. Use for unsorted department lists.",
    "highest_salary: returns highest paid employee with name, department, salary. Inputs: none. Use for company-wide highest salary employee.",
    "lowest_salary: returns lowest paid employee with name, department, salary. Inputs: none. Use for company-wide lowest salary employee.",
    "average_salary: returns company averageSalary. Inputs: none. Use only for company-wide average salary.",
    "employee_count: returns employee count. Inputs: optional department. Use for total count or simple department count.",
    "salary_difference: returns highest/lowest salary difference or named employee difference. Inputs: optional first_employee, second_employee.",
    "average_salary_by_department: returns department and averageSalary sorted highest first. Inputs: optional department. Use for average salary by department and highest average salary department queries.",
    "highest_paid_department: returns department and averageSalary for department with highest average salary. Inputs: none. Use for highest average salary department.",
    "employee_count_by_department: returns department and count. Inputs: department. Use when department is known or from previous step.",
    "highest_paid_employee_in_department: returns name, department, salary. Inputs: department. Use for top earner in a department.",
    "lowest_paid_employee_in_department: returns name, department, salary. Inputs: department. Use for lowest earner in a department.",
    "compare_employee_salary: returns two named salaries and difference. Inputs: first_employee, second_employee. Use for who earns more / compare salaries.",
    "employees_above_average_salary: returns averageSalary and employees above it. Inputs: none.",
    "department_with_most_employees: returns department and count. Inputs: none.",
    "employees_by_department_sorted_by_salary: returns department employees sorted by salary. Inputs: department, optional direction asc|desc.",
    "department_payroll: returns department, payroll, employeeCount. Inputs: department. Use for department spending/payroll when department is known.",
    "highest_payroll_department: returns department, payroll, employeeCount. Inputs: none. Use for department spending the most on salaries.",
    "lowest_payroll_department: returns department, payroll, employeeCount. Inputs: none. Use for department spending the least on salaries.",
    "top_n_highest_paid_employees: returns top N highest paid employees. Inputs: optional n or limit.",
    "bottom_n_lowest_paid_employees: returns bottom N lowest paid employees. Inputs: optional n or limit.",
    "salary_range_search: returns employees between salaries. Inputs: min_salary, max_salary, optional limit.",
    "median_salary: returns medianSalary. Inputs: none.",
    "salary_statistics: returns employeeCount, averageSalary, medianSalary, minSalary, maxSalary, payroll. Inputs: none.",
    "department_salary_statistics: returns salary stats by department or one department. Inputs: optional department.",
    "",
    "CRITICAL SELECTION RULES",
    "- 'highest average salary' MUST use highest_paid_department or average_salary_by_department, never average_salary.",
    "- 'average salary by department' MUST use average_salary_by_department.",
    "- 'department spends most' or 'highest payroll department' MUST use highest_payroll_department.",
    "- 'department has most employees' MUST use department_with_most_employees.",
    "- 'salary statistics' MUST use salary_statistics.",
    "- 'department analytics' or 'department salary statistics' MUST use department_salary_statistics.",
    "",
    "FEW-SHOT EXAMPLES",
    "Q: Who has the highest salary?",
    "{\"steps\":[{\"tool\":\"highest_salary\"}]}",
    "Q: Who has the lowest salary?",
    "{\"steps\":[{\"tool\":\"lowest_salary\"}]}",
    "Q: What is the average salary?",
    "{\"steps\":[{\"tool\":\"average_salary\"}]}",
    "Q: Which department has the highest average salary?",
    "{\"steps\":[{\"tool\":\"highest_paid_department\"}]}",
    "Q: Show average salary by department.",
    "{\"steps\":[{\"tool\":\"average_salary_by_department\"}]}",
    "Q: Which department has the most employees?",
    "{\"steps\":[{\"tool\":\"department_with_most_employees\"}]}",
    "Q: What is the department payroll for Engineering?",
    "{\"steps\":[{\"tool\":\"department_payroll\",\"input\":{\"department\":\"Engineering\"}}]}",
    "Q: Which department spends the most on salaries?",
    "{\"steps\":[{\"tool\":\"highest_payroll_department\"}]}",
    "Q: Which department spends the least on salaries?",
    "{\"steps\":[{\"tool\":\"lowest_payroll_department\"}]}",
    "Q: How many employees are there?",
    "{\"steps\":[{\"tool\":\"employee_count\"}]}",
    "Q: How many employees work in Product?",
    "{\"steps\":[{\"tool\":\"employee_count_by_department\",\"input\":{\"department\":\"Product\"}}]}",
    "Q: What is the salary difference between highest and lowest paid employees?",
    "{\"steps\":[{\"tool\":\"salary_difference\"}]}",
    "Q: Compare Aarav and Maya salaries.",
    "{\"steps\":[{\"tool\":\"compare_employee_salary\",\"input\":{\"first_employee\":\"Aarav\",\"second_employee\":\"Maya\"}}]}",
    "Q: Who earns more, Aarav or Maya, and by how much?",
    "{\"steps\":[{\"tool\":\"compare_employee_salary\",\"input\":{\"first_employee\":\"Aarav\",\"second_employee\":\"Maya\"}}]}",
    "Q: List employees earning above the company average.",
    "{\"steps\":[{\"tool\":\"employees_above_average_salary\"}]}",
    "Q: List Engineering employees sorted by salary.",
    "{\"steps\":[{\"tool\":\"employees_by_department_sorted_by_salary\",\"input\":{\"department\":\"Engineering\",\"direction\":\"desc\"}}]}",
    "Q: Who is the highest paid employee in Engineering?",
    "{\"steps\":[{\"tool\":\"highest_paid_employee_in_department\",\"input\":{\"department\":\"Engineering\"}}]}",
    "Q: Who is the lowest paid employee in Sales?",
    "{\"steps\":[{\"tool\":\"lowest_paid_employee_in_department\",\"input\":{\"department\":\"Sales\"}}]}",
    "Q: Show department salary statistics.",
    "{\"steps\":[{\"tool\":\"department_salary_statistics\"}]}",
    "Q: Show company salary statistics.",
    "{\"steps\":[{\"tool\":\"salary_statistics\"}]}",
    "Q: List all employees.",
    "{\"steps\":[{\"tool\":\"list_employees\"}]}",
    "Q: Find employee Aarav.",
    "{\"steps\":[{\"tool\":\"search_employee\",\"input\":{\"query\":\"Aarav\"}}]}",
    "Q: Which department has the highest average salary and who is the highest paid employee in that department?",
    "{\"steps\":[{\"tool\":\"highest_paid_department\"},{\"tool\":\"highest_paid_employee_in_department\",\"input\":{\"department\":\"$step1.department\"}}]}",
    "Q: Which department has the most employees and what is the average salary there?",
    "{\"steps\":[{\"tool\":\"department_with_most_employees\"},{\"tool\":\"average_salary_by_department\",\"input\":{\"department\":\"$step1.department\"}}]}",
    "Q: Which department spends the most on salaries and how many employees work there?",
    "{\"steps\":[{\"tool\":\"highest_payroll_department\"},{\"tool\":\"employee_count_by_department\",\"input\":{\"department\":\"$step1.department\"}}]}",
    "Q: Show employees earning between 80000 and 120000.",
    "{\"steps\":[{\"tool\":\"salary_range_search\",\"input\":{\"min_salary\":80000,\"max_salary\":120000}}]}",
    "Q: Show top 5 highest paid employees.",
    "{\"steps\":[{\"tool\":\"top_n_highest_paid_employees\",\"input\":{\"n\":5}}]}",
    "Q: Show bottom 5 employees by salary.",
    "{\"steps\":[{\"tool\":\"bottom_n_lowest_paid_employees\",\"input\":{\"n\":5}}]}",
    "Q: What is the median salary?",
    "{\"steps\":[{\"tool\":\"median_salary\"}]}",
    "If outside employee analytics: {\"steps\":[]}"
  ].join("\n");
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
