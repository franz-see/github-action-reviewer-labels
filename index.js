const core = require('@actions/core');
const github = require('@actions/github');

async function createPrNumbers(octokit, context) {
    const prNumbers = []
    if (context.eventName === 'push') {
        const branchRef = context.payload.ref; // e.g., "refs/heads/main"
        const branchName = branchRef.replace('refs/heads/', '');

        const owner = context.repo.owner;
        const repo = context.repo.repo;

        // Fetch open pull requests targeting the default branch
        const { data: pullRequests } = await octokit.rest.pulls.list({
            owner,
            repo,
            state: 'open',
            head: branchName,
        });

        for (const pr of pullRequests) {
            console.log(`Found PR #${pr.number} targeting ${branchName}`);
            prNumbers.push(pr.number);
        }

        if (pullRequests.length === 0) {
            console.log(`No open pull requests found targeting ${branchName}.`);
        }
    } else if (context.eventName.startsWith('pull_request')) {
        const prNumber = context.payload.pull_request.number;
        prNumbers.push(prNumber);
    } else {
        console.log(`The event ${context.eventName} is not supported by this action.`);
    }
    return prNumbers
}

async function createLabelsIfNotExist(octokit, context, reviewerLabels) {
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    // Function to generate a random color in hexadecimal format
    function getRandomColor() {
        // Generate a random number between 0 and 0xFFFFFF (16777215), then convert it to a hexadecimal string
        return Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    }

    for (const label of reviewerLabels) {
        try {
            await octokit.rest.issues.getLabel({
                owner,
                repo,
                name: label,
            });
        } catch (error) {
            if (error.status === 404) {
                console.log(`Label ${label} not found, creating it.`);
                await octokit.rest.issues.createLabel({
                    owner,
                    repo,
                    name: label,
                    color: getRandomColor(),
                    description: 'Auto-generated reviewer label',
                });
            } else {
                throw error;
            }
        }
    }
}


async function run() {
    try {
        const token = core.getInput('repo-token', {required: true});
        const octokit = github.getOctokit(token);
        const context = github.context;

        const owner = context.repo.owner;
        const repo = context.repo.repo;
        const prNumbers = await createPrNumbers(octokit, context);

        for (const prNumber of prNumbers) {
            // Fetch PR to get the current list of reviewers
            const {data: prData} = await octokit.rest.pulls.get({
                owner,
                repo,
                pull_number: prNumber,
            });

            const currentReviewerLabels = prData.requested_reviewers.map(reviewer => `reviewer:${reviewer.login}`).slice(0, 5); // GitHub has a limit of 5 labels for this API
            console.log(`currentReviewerLabels = ${currentReviewerLabels.join(', ')}`)
            await createLabelsIfNotExist(octokit, context, currentReviewerLabels);

            // Get current labels on the PR
            const { data: currentLabels } = await octokit.rest.issues.listLabelsOnIssue({
                owner,
                repo,
                issue_number: prNumber,
            });

            const currentLabelNames = currentLabels.map(label => label.name);
            const reviewerLabelPrefix = 'reviewer:';
            const labelsToRemove = currentLabelNames.filter(name =>
                name.startsWith(reviewerLabelPrefix) && !currentReviewerLabels.includes(name));
            console.log(`labelsToRemove = ${labelsToRemove.join(', ')}`)

            // Remove labels for reviewers no longer assigned
            for (const labelToRemove of labelsToRemove) {
                await octokit.rest.issues.removeLabel({
                    owner,
                    repo,
                    issue_number: prNumber,
                    name: labelToRemove,
                });
                console.log(`Removed label: ${labelToRemove}`);
            }

            console.log(`Adding labels: ${currentReviewerLabels.join(', ')}`)
            await octokit.rest.issues.addLabels({
                owner,
                repo,
                issue_number: prNumber,
                labels: currentReviewerLabels,
            });

            console.log('Updated labels based on current reviewers:', currentReviewerLabels.join(', '));
        }
    } catch (error) {
        core.setFailed(`Action failed with error: ${error}`);
    }
}

run()
