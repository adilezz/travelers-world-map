import pandas as pd

# Read the specific map sheet directly
df = pd.read_excel('C:\\Users\\ADIL\\OneDrive\\Desktop\\folders\\travel\\Travelers world map project\\database\\Travelers World Map - Database Build.xlsx', sheet_name='Places (world)')

# Export as a standard CSV with no index and correct standard formatting
df.to_csv('C:\\Users\\ADIL\\OneDrive\\Desktop\\folders\\travel\\Travelers world map project\\database\\Kepler_Ready_Map.csv', index=False)
print("Kepler-ready CSV generated.")