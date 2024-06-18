import { octokit } from "./config.js";
import { Discussion, Edge } from "./types.js";

// Query to fetch discussions from GitHub
const query = `
query($org: String!, $cursor: String) {
  organization(login: $org) {
    repositories(first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          name
          discussions(first: 100) {
            edges {
              node {
                id
                title
                author {
                  login
                  avatarUrl
                }
                url
                category{
                  id
                  name
                  emoji
                }
                upvoteCount
                reactions {
                  totalCount
                }
                comments(first: 10) {
                  edges {
                    node {
                      author {
                        login
                        avatarUrl
                      }
                      upvoteCount
                      isAnswer
                    }
                  }
                }
                createdAt
                isAnswered
              }
            }
          }
        }
      }
    }
  }
}
`;
async function fetchDiscussionsForOrg(org: string, cursor = null) {
  const variables = { org, cursor };
  const response = await octokit.graphql(query, variables);
  const discussions = response.organization.repositories.edges.map(
    (edge: Edge) => edge.node.discussions.edges,
  );
  const hasNextPage = response.organization.repositories.pageInfo.hasNextPage;
  const nextCursor = response.organization.repositories.pageInfo.endCursor;

  const allDiscussions = discussions.flat();

  if (hasNextPage) {
    const nextDiscussions: Discussion[] = await fetchDiscussionsForOrg(
      org,
      nextCursor,
    );
    return allDiscussions.concat(nextDiscussions);
  }

  return allDiscussions;
}

async function parseDiscussionData(allDiscussions: Discussion[]) {
  const authorList = allDiscussions
    .map((d: Discussion) =>
      d.node.comments.edges.map((c) => c.node.author.login),
    )
    .flat();
  authorList.push(...allDiscussions.map((d) => d.node.author.login));
  const uniqueAuthors = [...new Set(authorList)];
  const authorDiscussionList = uniqueAuthors.map((author) => {
    const discussions = allDiscussions.filter(
      (d) =>
        d.node.author.login === author ||
        d.node.comments.edges.some((c) => c.node.author.login === author),
    );
    const data = discussions.map((d) => {
      return {
        id: d.node.id,
        title: d.node.title,
        url: d.node.url,
        createdAt: d.node.createdAt,
        author: d.node.author,
        category: d.node.category,
        isAnswered: d.node.isAnswered,
        upvoteCount: d.node.upvoteCount,
        participants: [
          ...new Map(
            d.node.comments.edges.map((c) => [
              c.node.author.login,
              {
                login: c.node.author.login,
                avatarUrl: c.node.author.avatarUrl,
                isAnswer: c.node.isAnswer,
                upvoteCount: c.node.upvoteCount,
              },
            ]),
          ).values(),
        ],
      };
    });
    return { user: author, discussions: data };
  });
  return authorDiscussionList;
}

export async function fetchAllDiscussionEventsByOrg(organizationName: string) {
  try {
    const allDiscussions = await fetchDiscussionsForOrg(organizationName);
    const parseDiscussion = await parseDiscussionData(allDiscussions);
    return parseDiscussion;
  } catch (error: any) {
    throw new Error(`Error fetching discussions: ${error.message}`);
  }
}
