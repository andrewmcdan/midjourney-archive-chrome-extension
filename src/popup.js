// added Estimated time left (per day)
// added some error handling
// added a delay into the loop to prevent the server from blocking the requests
// added a retry for failed jobs
// Changed currentDate.getIsoString() to currentDate.toLocaleString() to make sure the correct date is displayed

import JSZip from "jszip";

const zips = [];
let batchSize;
let onlyMetadata;
const waitSeconds = (s) => new Promise(resolve => setTimeout(resolve, 1000 * s));
document.getElementById("dateForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const startDate = new Date(event.target.startDate.value);
    const endDate = new Date(event.target.endDate.value);
    const upscaleSelection = document.querySelector('input[name="upscaleOptions"]:checked').value;
    batchSize = parseInt(event.target.batchSize.value);
    onlyMetadata = document.querySelector('input[name="onlyMetadata"]').checked;


    // Show progress container and hide form
    const progressContainer = document.getElementById("progressContainer");
    const progressDaysBar = document.getElementById("progressDaysBar");
    const progressDaysMessage = document.getElementById("progressDaysMessage");
    const progressJobsBar = document.getElementById("progressJobsBar");
    const progressJobsMessage = document.getElementById("progressJobsMessage");
    const form = document.getElementById("dateForm");
    const error = document.getElementById("error");
    const timeRemaining = document.getElementById("timeRemaining");
    form.classList.add("hidden");
    progressContainer.classList.remove("hidden");
    error.classList.add('hidden')

    let processedDays = 0;
    const totalDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    // Iterate through the dates and perform API calls
    for (let currentDate = startDate; currentDate <= endDate; currentDate.setDate(currentDate.getDate() + 1)) {
        // get current time 
        const currentTime = new Date();

        progressDaysMessage.innerText = `[${processedDays}/${totalDays}] Processing ${currentDate.toLocaleString()}...`;
        const settings = { "batch": 0, "date": {} };
        settings.date.year = currentDate.getFullYear();
        settings.date.month = currentDate.getMonth() + 1;
        settings.date.day = currentDate.getDate();

        // Fetch the archive data
        const archiveResponse = await fetch(`https://www.midjourney.com/api/app/archive/day/?day=${settings.date.day}&month=${settings.date.month}&year=${settings.date.year}`);
        if (archiveResponse.status === 403) {
            progressContainer.classList.add("hidden");
            form.classList.remove("hidden");
            error.classList.remove("hidden")
            error.innerText = "Received HTTP 403 Forbidden. It seems you're not logged into https://www.midjourney.com.";
            throw new Error(error.innerText);
        }
        const archiveData = await archiveResponse.json();

        // Create a zip file for the current date
        zips.push(newZip(settings));

        let processedJobs = 0;
        let totalJobs = archiveData.length;
        let redoJobs = [];

        // Process each item in the archive data
        for (const item of archiveData) {
            // const jobId = item.id;
            await waitSeconds(0.1);
            // get current time as currentTimeInLoop
            const currentTimeInLoop = new Date();
            // ge the difference between currentTime and currentTimeInLoop
            const timeDifference = currentTimeInLoop - currentTime;

            let estimatedTimeLeft;// = (timeDifference / processedJobs) * (totalJobs - processedJobs);

            estimatedTimeLeft = estimateRemainingTime(totalJobs, processedJobs, currentTime, currentTimeInLoop);

            // convert timeDifference to hours:minutes:seconds
            const timeDifferenceInHours = Math.floor(timeDifference / 1000 / 60 / 60);
            const timeDifferenceInMinutes = Math.floor(timeDifference / 1000 / 60) - (timeDifferenceInHours * 60);
            const timeDifferenceInSeconds = Math.floor(timeDifference / 1000) - (timeDifferenceInMinutes * 60);
            // display timeDifference in the console
            // console.log(`Time difference: ${timeDifferenceInHours} hours, ${timeDifferenceInMinutes} minutes, ${timeDifferenceInSeconds} seconds`);

            // convert estimatedTimeLeft to hours:minutes:seconds
            const estimatedTimeLeftInHours = Math.floor(estimatedTimeLeft / 1000 / 60 / 60);
            const estimatedTimeLeftInMinutes = Math.floor(estimatedTimeLeft / 1000 / 60) - (estimatedTimeLeftInHours * 60);
            const estimatedTimeLeftInSeconds = Math.floor(estimatedTimeLeft / 1000) - (estimatedTimeLeftInMinutes * 60);
            // display estimatedTimeLeft in the console
            // console.log(`Estimated time left: ${estimatedTimeLeftInHours} hours, ${estimatedTimeLeftInMinutes} minutes, ${estimatedTimeLeftInSeconds} seconds`);

            const jobId = item;

            progressJobsMessage.innerText = `[${processedJobs}/${totalJobs}] Fetching ${jobId}...`;

            timeRemaining.innerText = `Time remaining (for day ${processedDays} of ${totalDays}): ${estimatedTimeLeftInHours} hours, ${estimatedTimeLeftInMinutes} minutes, ${estimatedTimeLeftInSeconds} seconds`;

            // Fetch the job status data
            console.log({ jobId });
            let jobStatusResponse;
            let fetchWait = fetch("https://www.midjourney.com/api/app/job-status/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobIds: [jobId] }),
                timeout: 10000
            }).then((response) => {
                jobStatusResponse = response;
            }).catch((error) => {
                console.log({ error });
                redoJobs.push(jobId);
            });
            await Promise.all([fetchWait]);
            if (jobStatusResponse.status !== 200) {
                console.log({ jobStatusResponse });
                redoJobs.push(jobId);
                continue;
            }
            const jobStatusData = await jobStatusResponse.json();

            // console.log(jobStatusData);

            // Check job version
            let versionNumber;
            if (jobStatusData._parsed_params) {
                versionNumber = parseFloat(jobStatusData._parsed_params.niji) || parseFloat(jobStatusData._parsed_params.version);
            } else {
                versionNumber = "undefined";
            }
            let isVersion5Plus = !isNaN(versionNumber) && versionNumber >= 5;

            // Set event type
            let isUpscale = jobStatusData.type !== "grid"

            // Process images
            if (isVersion5Plus && !isUpscale && upscaleSelection === "allImagesV5Grids") {
                await processImages(jobStatusData);
            } else if (isVersion5Plus && isUpscale && upscaleSelection === "onlyV5Upscales") {
                await processImages(jobStatusData);
            } else if (!isVersion5Plus && isUpscale) {
                await processImages(jobStatusData);
            }

            processedJobs++
            progressJobsBar.value = (processedJobs / totalJobs) * 100;
            progressJobsMessage.innerText = `[${processedJobs}/${totalJobs}] Fetched ${jobId}!`;
        }
        // Jobs that failed to download will be retried.
        processedJobs = 0;
        if (redoJobs.length > 0) {
            console.log({ redoJobs });
            for (const jobId of redoJobs) {
                await waitSeconds(0.1);
                // get current time as currentTimeInLoop
                const currentTimeInLoop = new Date();
                // ge the difference between currentTime and currentTimeInLoop
                const timeDifference = currentTimeInLoop - currentTime;

                let estimatedTimeLeft;// = (timeDifference / processedJobs) * (totalJobs - processedJobs);

                estimatedTimeLeft = estimateRemainingTime(totalJobs, processedJobs, currentTime, currentTimeInLoop);

                // convert timeDifference to hours:minutes:seconds
                const timeDifferenceInHours = Math.floor(timeDifference / 1000 / 60 / 60);
                const timeDifferenceInMinutes = Math.floor(timeDifference / 1000 / 60) - (timeDifferenceInHours * 60);
                const timeDifferenceInSeconds = Math.floor(timeDifference / 1000) - (timeDifferenceInMinutes * 60);
                // display timeDifference in the console
                // console.log(`Time difference: ${timeDifferenceInHours} hours, ${timeDifferenceInMinutes} minutes, ${timeDifferenceInSeconds} seconds`);

                // convert estimatedTimeLeft to hours:minutes:seconds
                const estimatedTimeLeftInHours = Math.floor(estimatedTimeLeft / 1000 / 60 / 60);
                const estimatedTimeLeftInMinutes = Math.floor(estimatedTimeLeft / 1000 / 60) - (estimatedTimeLeftInHours * 60);
                const estimatedTimeLeftInSeconds = Math.floor(estimatedTimeLeft / 1000) - (estimatedTimeLeftInMinutes * 60);
                // display estimatedTimeLeft in the console
                // console.log(`Estimated time left: ${estimatedTimeLeftInHours} hours, ${estimatedTimeLeftInMinutes} minutes, ${estimatedTimeLeftInSeconds} seconds`);

                progressJobsMessage.innerText = `Retrying [${processedJobs}/${redoJobs.length}] Fetching ${jobId}...`;

                timeRemaining.innerText = `Time remaining (for day ${processedDays} of ${totalDays}): ${estimatedTimeLeftInHours} hours, ${estimatedTimeLeftInMinutes} minutes, ${estimatedTimeLeftInSeconds} seconds`;
                console.log({ jobId });
                let jobStatusResponse;
                let fetchWait = fetch("https://www.midjourney.com/api/app/job-status/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jobIds: [jobId] }),
                    timeout: 10000
                }).then((response) => {
                    jobStatusResponse = response;
                }).catch((error) => {
                    console.log("Error fetching job-status. Error:\n", { error });
                    // redoJobs.push(jobId);
                });
                await Promise.all([fetchWait]);
                if (jobStatusResponse.status !== 200) {
                    console.log({ jobStatusResponse });
                    // redoJobs.push(jobId);
                    continue;
                }
                const jobStatusData = await jobStatusResponse.json();

                // console.log(jobStatusData);

                // Check job version
                let versionNumber;
                if (jobStatusData._parsed_params) {
                    versionNumber = parseFloat(jobStatusData._parsed_params.niji) || parseFloat(jobStatusData._parsed_params.version);
                } else {
                    versionNumber = "undefined";
                }
                let isVersion5Plus = !isNaN(versionNumber) && versionNumber >= 5;

                // Set event type
                let isUpscale = jobStatusData.type !== "grid"

                // Process images
                if (isVersion5Plus && !isUpscale && upscaleSelection === "allImagesV5Grids") {
                    await processImages(jobStatusData);
                } else if (isVersion5Plus && isUpscale && upscaleSelection === "onlyV5Upscales") {
                    await processImages(jobStatusData);
                } else if (!isVersion5Plus && isUpscale) {
                    await processImages(jobStatusData);
                }

                processedJobs++
                progressJobsBar.value = (processedJobs / redoJobs.length) * 100;
                progressJobsMessage.innerText = `Retrying [${processedJobs}/${redoJobs.length}] Fetched ${jobId}!`;
            }
        }
        processedDays++;
        progressDaysBar.value = (processedDays / totalDays) * 100;

        // Generate and download the zip file
        let zip = zips[zips.length - 1];
        if (zip.fileCount > 0) downloadZip(zip);
    }
    progressDaysMessage.innerText = "Download complete!";
});

async function processImages(jobStatusData) {
    // Download and process images
    const { image_paths, id, enqueue_time, prompt } = jobStatusData;

    if (image_paths !== null) {
        jobStatusData._archived_files = [];

        for (const [index, imagePath] of image_paths.entries()) {
            let zip = zips[zips.length - 1];

            if (!onlyMetadata) {
                // Fetch the image
                const response = await fetch(imagePath);
                const imageBlob = await response.blob();

                // Filename conversions
                const truncated_prompt = makeFilenameCompatible(prompt, 48);
                const datetime = convertDateTimeFormat(enqueue_time);

                // Add EXIF metadata
                const modifiedBlob = await addExifMetadata(imageBlob, jobStatusData);

                // Build filename
                let filename;
                if (image_paths.length > 1) {
                    filename = `${datetime}_${id}_${index}_${truncated_prompt}.png`
                } else {
                    filename = `${datetime}_${id}_${truncated_prompt}.png`
                }
                jobStatusData._archived_files.push(filename);

                // Add the image to the zip file
                zip.archive.file(filename, modifiedBlob);
            }

            zip.fileCount++;

            // Add jobStatusData to zip.jobs if it doesn't already exist
            if (!zip.jobs.includes(jobStatusData)) {
                zip.jobs.push(jobStatusData);
            }

            // Create a new zip file if the current one is full
            if (zip.fileCount == batchSize) {
                downloadZip(zip);
                zips.push(newZip(zip.settings));
            }
        }
    }
}

function newZip(settings) {
    let archive = new JSZip();
    let fileCount = 0;
    let jobs = [];
    let zipSettings = { "batch": settings.batch + 1, "date": settings.date }

    return { "archive": archive, "fileCount": fileCount, "jobs": jobs, "settings": zipSettings };
}

async function downloadZip(zip) {
    zip.archive.file("archived_jobs.json", JSON.stringify(zip.jobs));

    const zipBlob = await zip.archive.generateAsync({ type: "blob" });
    const downloadUrl = URL.createObjectURL(zipBlob);
    const downloadLink = document.createElement("a");

    let filename;
    if (Number.isNaN(batchSize)) {
        filename = `midjourney_archive_${zip.settings.date.year}-${zip.settings.date.month}-${zip.settings.date.day}_[${zip.fileCount}].zip`;
    } else {
        let start = (zip.settings.batch - 1) * batchSize + 1
        let fileCount = `${start}-${start + zip.fileCount - 1}`;
        filename = `midjourney_archive_${zip.settings.date.year}-${zip.settings.date.month}-${zip.settings.date.day}_[${fileCount}].zip`;
    }

    downloadLink.href = downloadUrl;
    downloadLink.download = filename;
    downloadLink.click();

    URL.revokeObjectURL(downloadUrl);
}

function makeFilenameCompatible(str, maxLength) {
    if (typeof str === 'undefined') {
        str = 'None';
    }
    let result = str.replace(/ /g, '_').replace(/[^\w-]/g, '');
    if (maxLength) {
        return result.length > maxLength ? result.substr(0, maxLength) : result;
    } else {
        return result;
    }
}

function convertDateTimeFormat(dateTimeString) {
    const dt = new Date(dateTimeString);
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, '0'); // Months are 0-based in JavaScript
    const day = String(dt.getDate()).padStart(2, '0');
    const hours = String(dt.getHours()).padStart(2, '0');
    const minutes = String(dt.getMinutes()).padStart(2, '0');
    const seconds = String(dt.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

async function addExifMetadata(imageBlob, jobStatusData) {
    // Implement this function to add the required EXIF metadata to the image
    // You may use a library like "piexifjs" to manipulate the EXIF data
    return imageBlob;
}

function estimateRemainingTime(totalNumberOfItems, completedItems, startTime, lastCompletionTime) {
    // Weight factor to give more importance to recent completion times
    const weightFactor = 0.7;

    // Calculate the average time per item for all items
    const avgTimePerItem = (lastCompletionTime - startTime) / completedItems;

    // Calculate weighted average giving more importance to recent items
    const weightedAvgTimePerItem = avgTimePerItem * weightFactor + avgTimePerItem * (1 - weightFactor);

    // Calculate the remaining items
    const remainingItems = totalNumberOfItems - completedItems;

    // Estimate the remaining time based on the weighted average time per item
    const estimatedRemainingTime = weightedAvgTimePerItem * remainingItems;

    return estimatedRemainingTime;
}