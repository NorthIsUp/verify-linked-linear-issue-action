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

    // Get configuration from action inputs
    const skipUsersInput = core.getInput('skip-users')
    const skipUsers = skipUsersInput
      ? skipUsersInput.split(',').map(u => u.trim())
      : []

    const missingMessage =
      'No Linear ticket found for this pull request. Please link an issue in Linear by mentioning the ticket.'

    if (!context) {
      throw new Error('No context found, exiting.')
    } else if (!context.payload.pull_request?.number) {
      throw new Error('No pull request number found in context, exiting.')
    } else if (!context.payload.pull_request?.user?.login) {
      throw new Error('No pull request user login found in context, exiting.')
    }

    core.debug('Searching for Linear ticket link ...')

    const prAuthor = context.payload.pull_request.user.login

    // Check if user should be skipped
    core.debug(`Checking if user should be skipped: ${prAuthor} in ${skipUsers.join(', ')}`)
    if (skipUsers.includes(prAuthor)) {
      core.notice(`Skipping verification for user: ${prAuthor}`)
      return
    }
    core.debug(`Checking comments for verification for user: ${prAuthor}...`)

    // Get all comments on the PR
    // note this will only get ~30 comments at a time, but this should be enough
    const comments = await octokit.rest.issues.listComments({
      issue_number: context.payload.pull_request?.number,
      owner: context.repo.owner,
      repo: context.repo.repo
    })
    core.debug(`Found ${comments.data.length} comments on the PR ...`)

    // Delete any previous comments made by this action
    const actionComments = comments.data.filter(
      (comment: IssueComment) =>
        comment.user?.type === 'Bot' && comment.body?.includes(missingMessage)
    )

    if (actionComments.length > 0) {
      core.notice(`Cleaning up ${actionComments.length} comments to delete ...`)
    } else {
      core.debug(`No comments to delete ...`)
    }

    for (const comment of actionComments) {
      core.notice(`Cleaning up comment id: ${comment.id}`)
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
      core.notice('Found Linear ticket')
    } else {
      const comment = await octokit.rest.issues.createComment({
        slug: 'verify-linked-issue-bot',
        issue_number: context.payload.pull_request?.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: missingMessage
      })
      core.debug(`Created comment ${comment.data.id}`)
      core.setFailed('No Linear ticket found')
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
