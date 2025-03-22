import sys
import os
sys.path.append(os.path.abspath("./Depth-Anything-V2"))

import logging
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
import uvicorn
import numpy as np
import torch
import open3d as o3d
import cv2
from PIL import Image

from depth_anything_v2.dpt import DepthAnythingV2

# Cấu hình logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Khởi tạo ứng dụng FastAPI
app = FastAPI()

# Serve static files (HTML, JS, CSS)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Load mô hình DepthAnythingV2
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Using device: {DEVICE}")
model = DepthAnythingV2(encoder="vitl")
model.load_state_dict(torch.load("depth_anything_v2_vitl.pth", map_location=DEVICE))
model.to(DEVICE).eval()
logger.info("Model loaded successfully.")

def depth_to_point_cloud(depth_map, image):
    """Chuyển Depth Map thành Point Cloud"""
    h, w = depth_map.shape
    x, y = np.meshgrid(np.arange(w), np.arange(h))
    x = (x - w / 2) / 470.4
    y = (y - h / 2) / 470.4
    z = depth_map
    points = np.stack((np.multiply(x, z), np.multiply(y, z), z), axis=-1).reshape(-1, 3)
    colors = np.array(image).reshape(-1, 3) / 255.0

    # Tạo Open3D Point Cloud
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points)
    pcd.colors = o3d.utility.Vector3dVector(colors)

    # Đảm bảo thư mục outputs tồn tại
    output_dir = "outputs"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "output.ply")
    o3d.io.write_point_cloud(output_path, pcd)

    logger.info(f"Point cloud saved to: {output_path}")
    return output_path

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    # Kiểm tra loại tệp
    if not file.content_type.startswith("image/"):
        logger.warning(f"Invalid file type: {file.content_type}")
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload an image.")

    try:
        logger.info(f"Received file: {file.filename}")
        image = Image.open(file.file).convert("RGB")
        image_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

        # Tạo Depth Map từ ảnh RGB
        depth_map = model.infer_image(image_cv, image_cv.shape[0])

        # Convert Depth Map thành Point Cloud
        ply_path = depth_to_point_cloud(depth_map, image)

        return JSONResponse({"point_cloud": ply_path})
    except Exception as e:
        logger.error(f"Error processing file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

@app.get("/")
async def home():
    return FileResponse("static/index.html")

@app.get("/health")
async def health_check():
    """Endpoint kiểm tra sức khỏe của server"""
    return JSONResponse({"status": "ok"})

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)