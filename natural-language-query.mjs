import { generateExecutionPlan, generateStructuredQuery } from "./ai-provider.mjs";
import { executePlan } from "./executor.mjs";
import { executeExecutionPlan, validateExecutionPlan } from "./plan-executor.mjs";
import { validateStructuredQuery } from "./query-validator.mjs";
import { buildFinalResponse } from "./response-builder.mjs";

const DEBUG = (process.env.DEBUG_LOGS ?? "true").toLowerCase() === "true";


function shouldUseLLMPlanner(question) {
    const q = question.toLowerCase();

    if (/\band\b|\bthen\b|\balso\b/.test(q))
        return true;

    if (
        q.includes("compare") ||
        q.includes("difference") ||
        q.includes("between") ||
        q.includes("who earns more")
    )
        return true;

    if (
        q.includes("that department") ||
        q.includes("that employee") ||
        q.includes("that team") ||
        q.includes("that city") ||
        q.includes("there") ||
        q.includes("which one")
    )
        return true;

    if (
        q.includes("highest average") ||
        q.includes("most employees") ||
        q.includes("highest paid") ||
        q.includes("earns the most") ||
        q.includes("top earner")
    )
        return true;

    return false;
}

export async function runNaturalLanguageQuery(question) {
  const totalStart = Date.now();
  const input = normalize(question);
  if (!input) {
    return "Please provide a valid employee query.";
  }

  const guard = validateUserQuestion(input);
  if (!guard.ok) {
    return `Unsupported or unsafe query: ${guard.message}`;
  }
  
  
  // ---------- LLM Planner (for complex queries) ----------
const usePlanner =
    shouldUseLLMPlanner(input) ||
    input.includes(" and ");

if (usePlanner) {
  try {
    const llmPlan = await generateExecutionPlan(input);

if (!llmPlan || !llmPlan.plan) {
    throw new Error("LLM did not return an execution plan.");
}

const validation = validateExecutionPlan(llmPlan.plan);

    if (validation.ok) {
      return runExecutionPlan(input, validation.value, totalStart, {
        attempts: llmPlan.meta?.attempts ?? 1,
        llm_request_ms: llmPlan.meta?.llm_request_ms ?? 0,
        source: "llm"
      });
    }

    if (DEBUG) {
      console.error(`[plan_validation_error] ${validation.message}`);
      console.error("[planner_fallback] Falling back to deterministic planner.");
    }
  } catch (error) {
    if (DEBUG) {
      console.error(`[plan_generation_error] ${error.message}`);
      console.error("[planner_fallback] Falling back to deterministic planner.");
    }
  }
}

// ---------- Deterministic Planner (fallback + simple queries) ----------
const deterministicPlan = deterministicExecutionPlan(input);

if (deterministicPlan) {
  return runExecutionPlan(input, deterministicPlan, totalStart, {
    attempts: 0,
    llm_request_ms: 0,
    source: "deterministic"
  });
}



  
    

  let llmMeta = { llm_request_ms: 0, attempts: 0 };
  let structured = deterministicStructuredQuery(input);
  if (!structured) {
    try {
      const llmResult = await generateStructuredQuery(input);
      structured = llmResult.query;
      llmMeta = {
        llm_request_ms: llmResult.meta?.llm_request_ms ?? 0,
        attempts: llmResult.meta?.attempts ?? 1
      };
    } catch {
      structured = fallbackStructuredQuery(input);
    }
  }

  const validation = validateStructuredQuery(structured);
  if (!validation.ok) {
    if (DEBUG) {
      console.error(`[validation_error] ${validation.message}`);
    }
    return `Unsupported or unsafe query: ${validation.message}`;
  }

  const safeQuery = validation.value;
  if (safeQuery.operation === "clarify") {
    return safeQuery.clarification_question;
  }

  const execution = await executePlan(safeQuery);
  const response = formatResponse(input, safeQuery, execution.rows);

  if (DEBUG) {
    console.error(`[retry_attempts] ${llmMeta.attempts}`);
    console.error(`[llm_request_ms] ${llmMeta.llm_request_ms}`);
    console.error(`[mongodb_execution_ms] ${execution.mongodb_execution_ms}`);
    console.error(`[total_ms] ${Date.now() - totalStart}`);
    console.error(`[query_plan] ${JSON.stringify(safeQuery)}`);
  }

  return response;
}

async function runExecutionPlan(question, plan, totalStart, meta) {
  const execution = await executeExecutionPlan(plan, {
    question,
    logger: DEBUG ? console.error : null
  });
  const response = await buildFinalResponse(question, plan, execution);

  if (DEBUG) {
    console.error(`[plan_source] ${meta.source}`);
    console.error(`[retry_attempts] ${meta.attempts}`);
    console.error(`[llm_request_ms] ${meta.llm_request_ms}`);
    console.error(`[total_ms] ${Date.now() - totalStart}`);
    console.error(`[execution_plan] ${JSON.stringify(plan)}`);
    
  }

  return response;
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function validateUserQuestion(question) {
  const q = question.toLowerCase();
  const blocked = [
    "drop table",
    "delete from",
    "insert into",
    "update employees set",
    "truncate",
    "alter table",
    "ignore previous",
    "ignore all previous",
    "system prompt",
    "developer message",
    "reveal prompt",
    "show prompt",
    "run shell",
    "execute command"
  ];

  if (blocked.some((term) => q.includes(term))) {
    return { ok: false, message: "request contains blocked injection or database mutation language." };
  }

  const employeeDomain =
    q.includes("employee") ||
    q.includes("employees") ||
    q.includes("salary") ||
    q.includes("paid") ||
    q.includes("earns") ||
    q.includes("earning") ||
    q.includes("payroll") ||
    q.includes("spends") ||
    q.includes("statistics") ||
    q.includes("median") ||
    q.includes("department") ||
    q.includes("aarav") ||
    q.includes("maya") ||
    q.includes("engineering") ||
    q.includes("finance") ||
    q.includes("product") ||
    q.includes("sales") ||
    q.includes("human resources") ||
    q.includes("administration") ||
    q.includes("legal") ||
    q.includes("operations");

  if (!employeeDomain) {
    return { ok: false, message: "question is outside the employee analytics domain." };
  }

  return { ok: true };
}

function formatResponse(question, safeQuery, rows) {
  if (!rows || rows.length === 0) {
    return "No matching employees found.";
  }

  if (safeQuery.operation === "count") {
    return `There are ${rows[0].count} employees.`;
  }

  if (safeQuery.operation === "aggregate") {
    if (rows[0] && typeof rows[0].count === "number") {
      return `There are ${rows[0].count} employees.`;
    }
    return rows
      .slice(0, 20)
      .map((row) => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(" | "))
      .join("\n");
  }

  return rows
    .slice(0, 20)
    .map((row) => {
      const dateText = row.joiningDate ? new Date(row.joiningDate).toISOString().slice(0, 10) : "N/A";
      return `${row.name} | age ${row.age} | ${row.department} | salary ${row.salary} | ${row.city} | joined ${dateText} | remote:${row.remote}`;
    })
    .join("\n");
}

function deterministicExecutionPlan(question) {
  const q = question.toLowerCase();



 

  


  const comparison = extractSalaryComparison(q);
  if (comparison) {
    return {
      steps: [
        { tool: "get_employee_salary", input: { employee: comparison.first } },
        { tool: "get_employee_salary", input: { employee: comparison.second } },
        {
          tool: "compare_employee_salary",
          input: {
            first_employee: comparison.first,
            second_employee: comparison.second
          }
        }
      ]
    };
  }

  if (q.includes("difference") && q.includes("highest") && q.includes("lowest") && q.includes("salary")) {
    return { steps: [{ tool: "salary_difference" }] };
  }

  

  if (q.includes("highest average salary") && q.includes("department")) {
    return { steps: [{ tool: "highest_paid_department" }] };
  }

  if (q.includes("average salary by department") || q.includes("average salary in each department")) {
    return { steps: [{ tool: "average_salary_by_department" }] };
  }

  const highestInDepartment = q.match(/highest (?:salary|paid|earning|earns).*\bin\s+([a-z ]+)/i);
  if (highestInDepartment?.[1]) {
    return {
      steps: [
        {
          tool: "highest_paid_employee_in_department",
          input: { department: title(highestInDepartment[1].replace(/[?!.]/g, "").trim()) }
        }
      ]
    };
  }

  if (q.includes("earning above the average salary") || q.includes("salary above average")) {
    return { steps: [{ tool: "employees_above_average_salary" }] };
  }

  if (q.includes("department has the most employees") || q.includes("department with the most employees")) {
    return { steps: [{ tool: "department_with_most_employees" }] };
  }

  if (q.includes("spends the most") || q.includes("highest payroll") || q.includes("highest spending")) {
    return { steps: [{ tool: "highest_payroll_department" }] };
  }

  if (q.includes("spends the least") || q.includes("lowest payroll") || q.includes("lowest spending")) {
    return { steps: [{ tool: "lowest_payroll_department" }] };
  }

  const departmentPayroll = q.match(/(?:payroll|spending|spend).*(?:for|in)\s+([a-z ]+)/i);
  if (departmentPayroll?.[1]) {
    return {
      steps: [
        {
          tool: "department_payroll",
          input: { department: title(departmentPayroll[1].replace(/[?!.]/g, "").trim()) }
        }
      ]
    };
  }

  const sortedDepartment = q.match(/(?:list|show)\s+([a-z ]+)\s+employees.*salary/i);
  if (sortedDepartment?.[1]) {
    return {
      steps: [
        {
          tool: "employees_by_department_sorted_by_salary",
          input: {
            department: title(sortedDepartment[1].replace(/[?!.]/g, "").trim()),
            direction: q.includes("ascending") || q.includes("lowest first") ? "asc" : "desc"
          }
        }
      ]
    };
  }

  const topN = q.match(/top\s+(\d+).*(?:paid|salary)/i);
  if (topN) {
    return { steps: [{ tool: "top_n_highest_paid_employees", input: { n: Number(topN[1]) } }] };
  }

  const bottomN = q.match(/bottom\s+(\d+).*(?:paid|salary|employees)/i);
  if (bottomN) {
    return { steps: [{ tool: "bottom_n_lowest_paid_employees", input: { n: Number(bottomN[1]) } }] };
  }

  const betweenSalary = q.match(/(?:salary|earning|earn).*between\s+(\d+)\s+and\s+(\d+)/i);
  if (betweenSalary) {
    return {
      steps: [
        {
          tool: "salary_range_search",
          input: { min_salary: Number(betweenSalary[1]), max_salary: Number(betweenSalary[2]) }
        }
      ]
    };
  }

  if (q.includes("highest salary") || q.includes("highest paid") || q.includes("top paid")) {
    return { steps: [{ tool: "highest_salary" }] };
  }

  if (q.includes("lowest salary") || q.includes("lowest paid") || q.includes("least paid") || q.includes("earns the least")) {
    return { steps: [{ tool: "lowest_salary" }] };
  }

  if (q.includes("average salary")) {
    return { steps: [{ tool: "average_salary" }] };
  }

  if (q.includes("median salary")) {
    return { steps: [{ tool: "median_salary" }] };
  }

  if (q.includes("salary statistics") || q.includes("salary stats")) {
    return { steps: [{ tool: q.includes("department") ? "department_salary_statistics" : "salary_statistics" }] };
  }

  if (q.includes("how many employees") || q.includes("employee count")) {
    return { steps: [{ tool: "employee_count" }] };
  }

  const departmentList = q.match(/(?:list|show)\s+employees\s+in\s+([a-z ]+)/i);
  if (departmentList?.[1]) {
    return {
      steps: [
        {
          tool: "employees_by_department",
          input: { department: title(departmentList[1].replace(/[?!.]/g, "").trim()) }
        }
      ]
    };
  }

  return null;
}

function hasAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function extractSalaryComparison(question) {
  if (!question.includes("compare") && !question.includes("difference") && !question.includes("earns more")) {
    return null;
  }

  const match =
    question.match(/salaries of\s+([a-z ]+?)\s+(?:and|with)\s+([a-z ]+?)(?:[?!.]|$)/i) ??
    question.match(/(?:earns more|who earns more)\s+(?:between\s+)?([a-z ]+?)\s+(?:and|or|with)\s+([a-z ]+?)(?:[?!.]|$)/i) ??
    question.match(/(?:compare|difference between)\s+([a-z ]+?)\s+(?:and|with)\s+([a-z ]+?)(?:\s+salaries|\s+salary|[?!.]|$)/i);

  if (!match) {
    return null;
  }

  return {
    first: title(match[1].trim()),
    second: title(match[2].trim())
  };
}

function fallbackStructuredQuery(question) {
  const q = question.toLowerCase();

  const bonusLess = q.match(/bonus\s+(?:less than|below|under)\s+(\d+)/);
  if (bonusLess && (q.includes("how much employee") || q.includes("how many employee") || q.includes("count"))) {
    return {
      operation: "aggregate",
      collection: "employee_payroll",
      pipeline: [
        { $match: { bonus: { $lt: Number(bonusLess[1]) } } },
        { $group: { _id: "$employeeId" } },
        { $count: "count" }
      ]
    };
  }

  const under = q.match(/salary\s+(under|below|less than)\s+(\d+)/);
  const over =
    q.match(/salary\s+(above|over|greater than|more than)\s+(\d+)/) ??
    q.match(/earning\s+(above|over|greater than|more than)\s+(\d+)/) ??
    q.match(/earn\s+(above|over|greater than|more than)\s+(\d+)/);
  const between = q.match(/salary.*between\s+(\d+)\s+and\s+(\d+)/);
  const startsWith = q.match(/names?\s+start(?:s)?\s+with\s+([a-z])/i);
  const olderThan = q.match(/older than\s+(\d+)/);
  const dept = q.match(/in\s+([a-z ]+)\s+department/);
  const cityList = q.match(/from\s+([a-z ]+)\s+or\s+([a-z ]+)/);
  const remote = /remote/.test(q);

  const andFilters = [];
  if (under) andFilters.push({ salary: { $lt: Number(under[2]) } });
  if (over) andFilters.push({ salary: { $gt: Number(over[2]) } });
  if (between) andFilters.push({ salary: { $gte: Number(between[1]), $lte: Number(between[2]) } });
  if (olderThan) andFilters.push({ age: { $gt: Number(olderThan[1]) } });
  if (dept?.[1]) andFilters.push({ department: { $regex: escapeRegex(title(dept[1].trim())), $options: "i" } });
  if (remote) andFilters.push({ remote: true });
  if (startsWith?.[1]) andFilters.push({ name: { $regex: `^${startsWith[1]}`, $options: "i" } });

  let filter = {};
  if (cityList) {
    const first = title(cityList[1].trim());
    const second = title(cityList[2].trim());
    const cityOr = {
      $or: [
        { city: { $regex: `^${escapeRegex(first)}$`, $options: "i" } },
        { city: { $regex: `^${escapeRegex(second)}$`, $options: "i" } }
      ]
    };
    filter = andFilters.length > 0 ? { $and: [...andFilters, cityOr] } : cityOr;
  } else if (andFilters.length === 1) {
    filter = andFilters[0];
  } else if (andFilters.length > 1) {
    filter = { $and: andFilters };
  }

  if (q.includes("average salary in each department")) {
    return {
      operation: "aggregate",
      pipeline: [{ $group: { _id: "$department", averageSalary: { $avg: "$salary" } } }]
    };
  }

  if (q.includes("how many employees are there in each city")) {
    return {
      operation: "aggregate",
      pipeline: [{ $group: { _id: "$city", employeeCount: { $sum: 1 } } }]
    };
  }

  if (q.includes("which department has the highest average salary")) {
    return {
      operation: "aggregate",
      pipeline: [
        { $group: { _id: "$department", averageSalary: { $avg: "$salary" } } },
        { $sort: { averageSalary: -1 } },
        { $limit: 1 }
      ]
    };
  }

  if (q.includes("which department has the youngest average employee age")) {
    return {
      operation: "aggregate",
      pipeline: [
        { $group: { _id: "$department", averageAge: { $avg: "$age" } } },
        { $sort: { averageAge: 1 } },
        { $limit: 1 }
      ]
    };
  }

  if (q.includes("which city has the lowest average salary")) {
    return {
      operation: "aggregate",
      pipeline: [
        { $group: { _id: "$city", averageSalary: { $avg: "$salary" } } },
        { $sort: { averageSalary: 1 } },
        { $limit: 1 }
      ]
    };
  }

  if (q.includes("top 5 highest paid employees")) {
    return { operation: "find", filter: {}, sort: { salary: -1 }, limit: 5 };
  }

  const avgSalaryExceeds = q.match(/average salary (?:exceeds|above|over|greater than)\s+(\d+)/);
  if (q.includes("departments") && avgSalaryExceeds) {
    return {
      operation: "aggregate",
      pipeline: [
        { $group: { _id: "$department", averageSalary: { $avg: "$salary" } } },
        { $match: { averageSalary: { $gt: Number(avgSalaryExceeds[1]) } } }
      ]
    };
  }

  const cityCountExceeds = q.match(/employee count (?:exceeds|above|over|greater than)\s+(\d+)/);
  if (q.includes("cities") && cityCountExceeds) {
    return {
      operation: "aggregate",
      pipeline: [
        { $group: { _id: "$city", employeeCount: { $sum: 1 } } },
        { $match: { employeeCount: { $gt: Number(cityCountExceeds[1]) } } }
      ]
    };
  }

  const avgAgeBelow = q.match(/average (?:employee )?age (?:below|under|less than)\s+(\d+)/);
  if (q.includes("departments") && avgAgeBelow) {
    return {
      operation: "aggregate",
      pipeline: [
        { $group: { _id: "$department", averageAge: { $avg: "$age" } } },
        { $match: { averageAge: { $lt: Number(avgAgeBelow[1]) } } }
      ]
    };
  }

  const hasComparativeKeyword =
    q.includes("highest") ||
    q.includes("lowest") ||
    q.includes("youngest") ||
    q.includes("oldest") ||
    q.includes("maximum") ||
    q.includes("minimum") ||
    q.includes("top") ||
    q.includes("bottom");

  if (hasComparativeKeyword) {
    if (q.includes("department")) {
      if (q.includes("age") || q.includes("youngest") || q.includes("oldest")) {
        return {
          operation: "aggregate",
          pipeline: [
            { $group: { _id: "$department", averageAge: { $avg: "$age" } } },
            { $sort: { averageAge: q.includes("youngest") || q.includes("minimum") ? 1 : -1 } },
            { $limit: 1 }
          ]
        };
      }
      return {
        operation: "aggregate",
        pipeline: [
          { $group: { _id: "$department", averageSalary: { $avg: "$salary" } } },
          { $sort: { averageSalary: q.includes("lowest") || q.includes("minimum") || q.includes("bottom") ? 1 : -1 } },
          { $limit: 1 }
        ]
      };
    }

    if (q.includes("city")) {
      return {
        operation: "aggregate",
        pipeline: [
          { $group: { _id: "$city", averageSalary: { $avg: "$salary" } } },
          { $sort: { averageSalary: q.includes("lowest") || q.includes("minimum") || q.includes("bottom") ? 1 : -1 } },
          { $limit: 1 }
        ]
      };
    }

    if (q.includes("salary")) {
      return {
        operation: "find",
        filter,
        sort: { salary: q.includes("lowest") || q.includes("minimum") || q.includes("bottom") ? "asc" : "desc" },
        limit: q.includes("top") || q.includes("bottom") ? 5 : 1
      };
    }
  }

  const aggregateTrigger =
    q.includes("average") ||
    q.includes("total") ||
    q.includes("group") ||
    q.includes("statistics") ||
    q.includes("analytics") ||
    q.includes("count by") ||
    q.includes("counts by") ||
    q.includes("by category") ||
    /\b(?:highest|lowest|maximum|minimum)\b.+\bby\b/.test(q) ||
    q.includes("in each");

  if (aggregateTrigger) {
    if (q.includes("by department")) {
      return {
        operation: "aggregate",
        pipeline: [{ $group: { _id: "$department", total: { $sum: 1 } } }]
      };
    }
    if (q.includes("by city")) {
      return {
        operation: "aggregate",
        pipeline: [{ $group: { _id: "$city", total: { $sum: 1 } } }]
      };
    }
    if (q.includes("salary")) {
      return {
        operation: "aggregate",
        pipeline: [{ $group: { _id: null, averageSalary: { $avg: "$salary" } } }]
      };
    }
    return {
      operation: "aggregate",
      pipeline: [{ $group: { _id: "$department", total: { $sum: 1 } } }]
    };
  }

  if (q.includes("how many")) {
    return { operation: "count", filter };
  }

  return {
    operation: "find",
    filter,
    sort: { name: "asc" },
    limit: 25
  };
}

function deterministicStructuredQuery(question) {
  const q = question.toLowerCase();
  const bonusLess = q.match(/bonus\s+(?:less than|below|under)\s+(\d+)/);
  if (bonusLess && (q.includes("how much employee") || q.includes("how many employee") || q.includes("count"))) {
    return {
      operation: "aggregate",
      collection: "employee_payroll",
      pipeline: [
        { $match: { bonus: { $lt: Number(bonusLess[1]) } } },
        { $group: { _id: "$employeeId" } },
        { $count: "count" }
      ]
    };
  }
  return null;
}

function title(value) {
  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
