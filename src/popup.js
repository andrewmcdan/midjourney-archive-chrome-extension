import JSZip from "jszip";

document.getElementById("dateForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const startDate = new Date(event.target.startDate.value);
  const endDate = new Date(event.target.endDate.value);
  const upscaleSelection = document.querySelector('input[name="upscaleOptions"]:checked').value;

  // Show progress container and hide form
  const progressContainer = document.getElementById("progressContainer");
  const progressDaysBar = document.getElementById("progressDaysBar");
  const progressDaysMessage = document.getElementById("progressDaysMessage");
  const progressJobsBar = document.getElementById("progressJobsBar");
  const progressJobsMessage = document.getElementById("progressJobsMessage");
  const form = document.getElementById("dateForm");
  const error = document.getElementById("error");
  form.classList.add("hidden");
  progressContainer.classList.remove("hidden");
  error.classList.add('hidden')

  let processedDays = 0;
  const totalDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

  // Iterate through the dates and perform API calls
  for (let currentDate = startDate; currentDate <= endDate; currentDate.setDate(currentDate.getDate() + 1)) {
    progressDaysMessage.innerText = `[${processedDays}/${totalDays}] Processing ${currentDate.toISOString().slice(0, 10)}...`;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const day = currentDate.getDate();

    // Fetch the archive data
    const archiveResponse = await fetch(`https://www.midjourney.com/api/app/archive/day/?day=${day}&month=${month}&year=${year}`);
    if (archiveResponse.status === 403) {
      progressContainer.classList.add("hidden");
      form.classList.remove("hidden");
      error.classList.remove("hidden")
      error.innerText = "Received HTTP 403 Forbidden. It seems you're not logged into https://www.midjourney.com.";
      throw new Error(error.innerText);
    }
    const archiveData = await archiveResponse.json();

    // Create a zip file for the current date
    const zip = new JSZip();
    let fileCount = 0;

    let processedJobs = 0;
    let archivedJobs = []
    let totalJobs = archiveData.length;

    // Process each item in the archive data
    for (const item of archiveData) {
      // const jobId = item.id;
      const jobId = item;
      progressJobsMessage.innerText = `[${processedJobs}/${totalJobs}] Fetching ${jobId}...`;

      // Fetch the job status data
      const jobStatusResponse = await fetch("https://www.midjourney.com/api/app/job-status/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: [jobId] }),
      });
      const jobStatusData = await jobStatusResponse.json();

      console.log(jobStatusData);

      // Check job version
      let versionNumber = parseFloat(jobStatusData._parsed_params.niji) || parseFloat(jobStatusData._parsed_params.version);
      let isVersion5Plus = !isNaN(versionNumber) && versionNumber >= 5;

      // Set event type
      let eventType = jobStatusData.event.eventType

      // Process images
      if (isVersion5Plus && eventType !== "upscale" && upscaleSelection === "allImagesV5Grids") {
        fileCount += await processImages(jobStatusData, zip, archivedJobs);
      } else if (isVersion5Plus && eventType === "upscale" && upscaleSelection === "onlyV5Upscales") {
        fileCount += await processImages(jobStatusData, zip, archivedJobs);
      } else if (!isVersion5Plus && eventType === "upscale") {
        fileCount += await processImages(jobStatusData, zip, archivedJobs);
      }

      processedJobs++
      progressJobsBar.value = (processedJobs / totalJobs) * 100;
      progressJobsMessage.innerText = `[${processedJobs}/${totalJobs}] Fetched ${jobId}!`;
    }
    processedDays++;
    progressDaysBar.value = (processedDays / totalDays) * 100;

    // Generate and download the zip file
    if (fileCount > 0) {
      zip.file("archived_jobs.json", JSON.stringify(archivedJobs));

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const downloadUrl = URL.createObjectURL(zipBlob);
      const downloadLink = document.createElement("a");
      downloadLink.href = downloadUrl;
      downloadLink.download = `midjourney_archive_${year}-${month}-${day}_[${fileCount}].zip`;
      downloadLink.click();

      URL.revokeObjectURL(downloadUrl);
    }
  }
  progressDaysMessage.innerText = "Download complete!";
});

async function processImages(jobStatusData, zip, archivedJobs) {
  // Download and process images
  const { username, image_paths, id, parent_id, enqueue_time, full_command, prompt, event, _parsed_params } = jobStatusData;
  let fileCount = 0;

  if (image_paths !== null) {
    jobStatusData._archived_files = [];

    for (const [index, imagePath] of image_paths.entries()) {
      // Fetch the image
      const response = await fetch(imagePath);
      const imageBlob = await response.blob();

      // Filename conversions
      const truncated_username = makeFilenameCompatible(username);
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
      zip.file(filename, modifiedBlob);
      fileCount++;
    }

    archivedJobs.push(jobStatusData);
  }

  return fileCount;
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
