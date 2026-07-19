import { z } from "zod";

const AllowedOperation = z.enum(["find", "count", "aggregate", "clarify"]);
const AllowedCollection = z.enum(["employees", "employee_payroll", "employee_attendance", "employee_reviews"]);
const AllowedField = z.enum([
  "name", "age", "department", "salary", "city", "joiningDate", "remote",
  "employeeId", "month", "baseSalary", "bonus", "deductions", "netSalary", "currency", "paidAt",
  "date", "status", "checkInHour", "checkOutHour",
  "reviewDate", "rating", "goalsCompleted", "reviewer", "summary"
]);
const AllowedSortDirection = z.union([z.enum(["asc", "desc", "1", "-1"]), z.literal(1), z.literal(-1)]);

const ALLOWED_FILTER_OPERATORS = new Set([
  "$eq",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$regex",
  "$options",
  "$and",
  "$or"
]);

const BLOCKED_OPERATORS = new Set([
  "$where",
  "$function",
  "$accumulator",
  "$expr",
  "$jsonSchema",
  "$lookup",
  "$unionWith",
  "$out",
  "$merge"
]);
const ALLOWED_PIPELINE_STAGES = new Set(["$match", "$group", "$project", "$sort", "$limit", "$count"]);

const SortSchema = z
  .object({
    name: AllowedSortDirection.optional(),
    age: AllowedSortDirection.optional(),
    department: AllowedSortDirection.optional(),
    salary: AllowedSortDirection.optional(),
    city: AllowedSortDirection.optional(),
    joiningDate: AllowedSortDirection.optional(),
    remote: AllowedSortDirection.optional()
  })
  .strict();

const QuerySchema = z.object({
  operation: AllowedOperation,
  collection: AllowedCollection.optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
  projection: z.record(z.string(), z.union([z.literal(0), z.literal(1)])).optional(),
  sort: SortSchema.optional(),
  limit: z.number().int().positive().max(50).optional(),
  pipeline: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
  clarification_question: z.string().nullable().optional()
});

export function validateStructuredQuery(raw) {
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const query = parsed.data;
  if (query.operation === "clarify") {
    return {
      ok: true,
      value: {
        operation: "clarify",
        clarification_question: query.clarification_question ?? "Please clarify your request."
      }
    };
  }

  const collection = query.collection ?? "employees";

  if (query.operation === "aggregate") {
    const pipeline = query.pipeline ?? [];
    if (pipeline.length === 0) {
      return { ok: false, message: "aggregate operation requires non-empty pipeline." };
    }
    const pipelineCheck = validatePipeline(pipeline);
    if (!pipelineCheck.ok) {
      return pipelineCheck;
    }
  }

  const filter = query.filter ?? {};
  const filterCheck = validateFilterObject(filter, collection);
  if (!filterCheck.ok) {
    return filterCheck;
  }

  return {
    ok: true,
    value: {
      operation: query.operation,
      collection,
      filter,
      projection: query.projection ?? { _id: 0, name: 1, age: 1, department: 1, salary: 1, city: 1, joiningDate: 1, remote: 1 },
      sort: normalizeSort(query.sort ?? { name: "asc" }),
      limit: query.limit ?? 25,
      pipeline: query.pipeline ?? null
    }
  };
}

function validateFilterObject(obj, collection) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, message: "filter must be an object." };
  }

  const stack = [obj];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const [key, value] of Object.entries(current)) {
      if (key.startsWith("$")) {
        if (BLOCKED_OPERATORS.has(key)) {
          return { ok: false, message: `Blocked operator: ${key}` };
        }
        if (!ALLOWED_FILTER_OPERATORS.has(key)) {
          return { ok: false, message: `Unsupported operator: ${key}` };
        }
        if ((key === "$and" || key === "$or") && !Array.isArray(value)) {
          return { ok: false, message: `${key} must be an array.` };
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              return { ok: false, message: `${key} items must be objects.` };
            }
            stack.push(item);
          }
        } else if (value && typeof value === "object") {
          stack.push(value);
        }
        continue;
      }

      if (!AllowedField.options.includes(key)) {
        return { ok: false, message: `Invalid field in filter: ${key}` };
      }
      if (!isFieldAllowedForCollection(key, collection)) {
        return { ok: false, message: `Field ${key} is not allowed for collection ${collection}` };
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const op of Object.keys(value)) {
          if (!ALLOWED_FILTER_OPERATORS.has(op) || BLOCKED_OPERATORS.has(op)) {
            return { ok: false, message: `Invalid operator on field ${key}: ${op}` };
          }
        }
      }
    }
  }

  return { ok: true };
}

function isFieldAllowedForCollection(field, collection) {
  const byCollection = {
    employees: new Set(["name", "age", "department", "salary", "city", "joiningDate", "remote"]),
    employee_payroll: new Set(["employeeId", "month", "baseSalary", "bonus", "deductions", "netSalary", "currency", "paidAt"]),
    employee_attendance: new Set(["employeeId", "date", "status", "checkInHour", "checkOutHour"]),
    employee_reviews: new Set(["employeeId", "reviewDate", "rating", "goalsCompleted", "reviewer", "summary"])
  };
  return byCollection[collection]?.has(field) ?? false;
}

function normalizeSort(sortObj) {
  const output = {};
  for (const [field, dir] of Object.entries(sortObj)) {
    output[field] = dir === "desc" || dir === "-1" || dir === -1 ? -1 : 1;
  }
  return output;
}

function validatePipeline(pipeline) {
  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      return { ok: false, message: "pipeline stage must be an object." };
    }
    const keys = Object.keys(stage);
    if (keys.length !== 1) {
      return { ok: false, message: "each pipeline stage must contain exactly one stage key." };
    }
    const key = keys[0];
    if (!ALLOWED_PIPELINE_STAGES.has(key)) {
      return { ok: false, message: `unsupported pipeline stage: ${key}` };
    }
    if (BLOCKED_OPERATORS.has(key)) {
      return { ok: false, message: `blocked pipeline stage: ${key}` };
    }
    const value = stage[key];
    if (key === "$limit") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        return { ok: false, message: "$limit must be between 1 and 100." };
      }
    }
  }
  return { ok: true };
}
