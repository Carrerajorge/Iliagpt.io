import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";
import type { ResolvedCredential, ConnectorOperationResult } from "../../kernel/types";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

async function linearGraphQL(
  query: string,
  variables: Record<string, unknown>,
  credential: ResolvedCredential
): Promise<ConnectorOperationResult> {
  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential.accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await res.json();

  if (!res.ok || data.errors) {
    return {
      success: false,
      error: data.errors ? data.errors[0].message : `Linear API error (${res.status})`,
    };
  }

  return { success: true, data: data.data };
}

export const createHandler = (): ConnectorHandlerFactory => {
  return {
    async execute(operationId, input, credential) {
      switch (operationId) {
        case "linear_search_issues": {
          const queryStr = `
            query SearchIssues($query: String!, $first: Int) {
              issueSearch(query: $query, first: $first) {
                nodes {
                  id
                  title
                  identifier
                  url
                  state { name }
                  assignee { name }
                }
              }
            }
          `;
          const variables = {
            query: input.query as string,
            first: (input.limit as number) || 10,
          };
          const result = await linearGraphQL(queryStr, variables, credential);
          if (result.success) {
            return {
              success: true,
              data: { issues: (result.data as any).issueSearch.nodes },
            };
          }
          return result;
        }

        case "linear_create_issue": {
          const mutationStr = `
            mutation CreateIssue($teamId: String!, $title: String!, $description: String) {
              issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
                success
                issue {
                  id
                  identifier
                  title
                  url
                }
              }
            }
          `;
          const variables = {
            teamId: input.teamId as string,
            title: input.title as string,
            description: input.description as string | undefined,
          };
          const result = await linearGraphQL(mutationStr, variables, credential);
          if (result.success) {
            return {
              success: true,
              data: { created: (result.data as any).issueCreate.issue },
            };
          }
          return result;
        }

        default:
          return {
            success: false,
            error: {
              code: "UNKNOWN_OPERATION",
              message: `Unknown operation: ${operationId}`,
              retryable: false,
            },
          };
      }
    },
  };
};

export const handler = createHandler();
