import cv2
import numpy as np
from PIL import Image
import pytesseract
import os
from dotenv import load_dotenv #loaded dotenv file
import re
import pandas as pd
# import spacy  # Import spaCy library for natural language processing
# from spacy.matcher import Matcher  # Import Matcher class from spaCy's matcher module
import google.generativeai as genai

# Load environment variables from .env file
load_dotenv()

# Set up environment variables
UPLOAD_FOLDER = os.getenv('UPLOAD_FOLDER')
TESSERACT_CMD = os.getenv('TESSERACT_CMD')
CSV_FILE = os.getenv('CSV_FILE')
IMAGE_URL_PREFIX = os.getenv('IMAGE_URL_PREFIX')   # link for image
GENAI_API_KEY = os.getenv('GENAI_API_KEY')

genai.configure(api_key=GENAI_API_KEY)



# Set up the Tesseract executable path (adjust the path if necessary)
pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
# nlp = spacy.load('en_core_web_sm')  # Load English language model
# matcher = Matcher(nlp.vocab)  # Initialize Matcher with spaCy's vocabulary
def process_image(image_path):
    # Load the image
    image = cv2.imread(image_path)

    # Convert the image to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Apply sharpening filter
    kernel = np.array([[0, -1, 0], 
                       [-1, 5, -1], 
                       [0, -1, 0]])
    sharpened = cv2.filter2D(gray, -1, kernel)
    
    # Apply edge detection
    edges = cv2.Canny(sharpened, 50, 150, apertureSize=3)
    
    # Find contours
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Sort contours by area (largest to smallest) and take the largest one
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:1]
    
    for contour in contours:
        # Get the bounding box of the largest contour
        x, y, w, h = cv2.boundingRect(contour)
        # Crop the image to the bounding box
        cropped_image = image[y:y+h, x:x+w]
    
    # Convert the cropped image to PIL format for OCR
    cropped_image_pil = Image.fromarray(cv2.cvtColor(cropped_image, cv2.COLOR_BGR2RGB))
    text = pytesseract.image_to_string(image)  # Use cropped image for OCR
    
    return text

def extract_entities(text,image_path):
    student_name_pattern = r"Student Name - (.*)"
    organization_pattern = r"Organization - (.*)"
    date_from_pattern = r"Date from - (.*)"
    date_to_pattern = r"Date to - (.*)"
    Title_pattern  = r"Title - (.*)"
    sample_format='''
    Student Name - Falgun Patil

    Organization - International Institute of Information Technology

    Date from - 5 January - 2024

    Date to - 25 February - 2024

    Title - ESG Job Simulation
    '''
    model = genai.GenerativeModel('gemini-pro')
    response = model.generate_content(f"Extract entities from {text} use this sample format{sample_format} make sure the output folows the sample format exactly.Important!!! if you didn't find the entitites mentioned according to the sample assign value none")
    print(response.text)
    student_name = re.search(student_name_pattern, response.text).group(1)
    organization = re.search(organization_pattern, response.text).group(1)
    date_from = re.search(date_from_pattern, response.text).group(1)
    date_to= re.search(date_to_pattern, response.text).group(1)
    title= re.search(Title_pattern, response.text).group(1)


    # Create a DataFrame
    data = {
        "Name of the student": [student_name if student_name else "none"  ],
        "Industry name": [organization  if organization  else "none" ],
        "Date from": [date_from if date_from else "none" ],
        "Date to": [date_to if date_to else "none" ],
        "Title": [title if title else "none" ],
        "Image":[os.path.basename(image_path)]

        # "Single dates": [dates if dates else "none" ],
        # "Durations": [durations if durations else "none" ]  
    }
    df = pd.DataFrame(data)

    # Specify the CSV file name
    # csv_file = "entities.csv"
    
    # Write the DataFrame to a CSV file
    if os.path.exists(CSV_FILE):
        df.to_csv(CSV_FILE, mode='a', header=False, index=False)  # Append without header
    else:
        df.to_csv(CSV_FILE, index=False)  # Write with header if file doesn't exist
        
    return CSV_FILE

def main():
    # Get the single image file from the upload folder
    image_files = [f for f in os.listdir(UPLOAD_FOLDER) if os.path.isfile(os.path.join(UPLOAD_FOLDER, f))]
    
    
    if len(image_files) == 0:
        print("No image found in the directory.")
        return
    
    for img in image_files:
        # Assuming there is only one image in the directory
        image_path = os.path.join(UPLOAD_FOLDER, img)
        
        # Process the image and extract text
        extracted_text = process_image(image_path)
        
        # Extract entities and save to CSV
        csv_file = extract_entities(extracted_text,image_path)
        print(f"Entities extracted and saved to {csv_file}")
    print (extracted_text)

if __name__ == '__main__':
    main()