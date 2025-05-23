import * as core from '@actions/core'
import * as github from '@actions/github'
import { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods'

type IssueComment =
  RestEndpointMethodTypes['issues']['listComments']['response']['data'][0]

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const token = process.env.GITHUB_TOKEN as string
    const octokit = github.getOctokit(token)
    const context = github.context

    const missingMessage =
      'No Linear ticket found for this pull request. Please link an issue in Linear by mentioning the ticket.'

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    core.debug('Searching for Linear ticket link ...')

    if (!context.payload.pull_request?.number) {
      throw new Error('No pull request number found in context, exiting.')
    }

    // Get all comments on the PR
    const comments = await octokit.rest.issues.listComments({
      issue_number: context.payload.pull_request?.number,
      owner: context.repo.owner,
      repo: context.repo.repo
    })
    core.notice(`Found ${comments.data.length} comments on the PR ...`)

    // Delete any previous comments made by this action
    const actionComments = comments.data.filter(
      (comment: IssueComment) =>
        comment.user?.type === 'Bot' && comment.body?.includes(missingMessage)
    )
    core.notice(`Found ${actionComments.length} comments to delete ...`)

    for (const comment of actionComments) {
      core.notice(`Deleting comment ${comment.id} ...`)
      await octokit.rest.issues.deleteComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: comment.id
      })
    }

    // Check for Linear ticket link
    const linearComment = comments.data.find(
      (comment: IssueComment) =>
        comment.performed_via_github_app?.slug === 'linear' &&
        comment.body?.includes('href="https://linear.app/')
    )

    if (linearComment) {
      core.notice('Found Linear ticket.')
    } else {
      const comment = await octokit.rest.issues.createComment({
        slug: 'verify-linked-issue-bot',
        issue_number: context.payload.pull_request?.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: missingMessage
      })
      core.notice(`Created comment ${comment.data.id} ...`)
      core.setFailed('No Linear ticket found.')
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
